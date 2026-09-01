import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db } from "./client";
import { withPlatform, withPlatformAdmin } from "./scope";
import { tenants } from "./schema/tenants";
import { locations } from "./schema/locations";
import { plans } from "./schema/platform";
import { platformAuditLog } from "./schema/platform-users";
import { asTenantId, type TenantId, type UserId } from "@/lib/ids";

// Phase 1.5 — platform-side tenant creation. Replaces the CLI path
// in scripts/seed.ts's ensureTenant(): the same shape (a tenant row,
// a first location, an audit trail) but reachable through the UI
// without touching the superuser connection (architecture.md §5.6
// bans any request-path code from the privileged pool — "no
// exception, anywhere, for any reason"). Cross-tenant write path:
// withPlatformAdmin() opens a transaction and sets
// app.platform_admin = 'true' (db/scope.ts). The RLS policy added in
// migration 20260902200000_platform_admin_tenant_write.sql opens the
// INSERT path on tenants + locations to that session variable, while
// leaving tenant_isolation intact for every other caller.
//
// Single transaction by design: a partially-created tenant (header
// row but no first location, or both rows but no audit trail) is a
// state nobody can reason about. Either everything commits or nothing
// does. The preset pathway (Phase 2.2) will hook in alongside this
// transaction later — for now, preset fields stay null.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Intl.supportedValuesOf('timeZone') returns the ICU/CLDR list, not
// the full IANA database — and that list varies by Node version
// (Node 20 ships 'Asia/Calcutta' but not 'Asia/Kolkata'; the schema
// default). Build a stronger test: actually construct a DateTimeFormat
// with the candidate zone, which throws RangeError for an unknown
// zone. This exercises the same path the application uses for any
// "show me this in tenant-local time" conversion, so what this
// accepts matches what the rest of the code can format.
function isCanonicalTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const createTenantInput = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required.")
    .max(60)
    .regex(
      SLUG_RE,
      "Slug must be lowercase letters, numbers, or hyphens, and start and end with a letter or number.",
    ),
  timezone: z
    .string()
    .trim()
    .min(1)
    .default("Asia/Kolkata")
    .refine(isCanonicalTimezone, "Time zone is not a recognised IANA identifier."),
  planKey: z.string().trim().min(1).default("standard"),
  currency: z
    .string()
    .trim()
    .length(3, "Currency must be a 3-letter ISO 4217 code.")
    .regex(/^[A-Z]{3}$/, "Currency must be uppercase letters.")
    .default("INR"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_RE, "GSTIN format is invalid.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  locationName: z
    .string()
    .trim()
    .min(1, "First location name is required.")
    .max(200)
    .default("Main"),
  locationIsPrimary: z.boolean().default(true),
});
export type CreateTenantInput = z.input<typeof createTenantInput>;

export type CreateTenantOk = {
  kind: "ok";
  tenantId: TenantId;
};
export type CreateTenantError = {
  kind: "error";
  code:
    | "invalid"
    | "plan_not_found"
    | "slug_taken"
    | "internal";
  message: string;
};
export type CreateTenantResult = CreateTenantOk | CreateTenantError;

const SLUG_TAKEN_PG_CODE = "23505"; // Postgres unique_violation

// Reads the active plans for the new-tenant form's <select>. Plans is
// RLS-exempt (db/allowlist.ts); the withPlatform() wrapper is for the
// standing convention rather than for visibility — every platform-side
// read goes through it.
export async function listActivePlans(): Promise<
  Array<{ key: string; name: string; isDefault: boolean }>
> {
  return withPlatform(async () => {
    return db
      .select({
        key: plans.key,
        name: plans.name,
        isDefault: plans.isDefault,
      })
      .from(plans)
      .where(eq(plans.status, "active"))
      .orderBy(plans.sortOrder);
  });
}

export async function createTenant(
  rawInput: CreateTenantInput,
  ctx: { actorId: UserId },
): Promise<CreateTenantResult> {
  // zod at the boundary — server actions pass a FormData-derived
  // object whose shape is not trusted. Defaults applied here, not
  // at the type signature, so the form can omit optional fields.
  const parsed = createTenantInput.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      kind: "error",
      code: "invalid",
      message: first?.message ?? "Please check the form and try again.",
    };
  }
  const input = parsed.data;

  try {
    return await withPlatformAdmin(async (tx) => {
      // Plan lookup is a straight read on a platform-scoped table
      // (allowlist). No need for withPlatform() — the surrounding
      // platform_admin session doesn't change that visibility.
      const planRows = await tx
        .select({ id: plans.id, name: plans.name })
        .from(plans)
        .where(and(eq(plans.key, input.planKey), eq(plans.status, "active")))
        .limit(1);
      const plan = planRows[0];
      if (!plan) {
        return {
          kind: "error",
          code: "plan_not_found",
          message: `No active plan with key "${input.planKey}".`,
        };
      }

      // Three inserts, one transaction, atomic with the platform
      // audit row. The new platform_admin_insert policy
      // (migration 20260902200000) opens the INSERT path on
      // tenants and locations for app.platform_admin = 'true';
      // tenant_isolation still denies the inserts by its own
      // WITH CHECK, but Postgres OR-combines the policies —
      // one passing is enough.
      const [tenant] = await tx
        .insert(tenants)
        .values({
          id: asTenantId(uuidv7()),
          slug: input.slug,
          name: input.name,
          status: "trial",
          planId: plan.id,
          timezone: input.timezone,
          currency: input.currency,
          gstin: input.gstin ?? null,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })
        .returning({ id: tenants.id });
      if (!tenant) {
        throw new Error("createTenant: tenants insert returned no row");
      }

      await tx.insert(locations).values({
        id: uuidv7(),
        tenantId: tenant.id,
        name: input.locationName,
        isPrimary: input.locationIsPrimary,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      // platform_audit_log is RLS-exempt (db/allowlist.ts). The
      // insert goes through the same withPlatformAdmin transaction
      // so audit and data commit together.
      await tx.insert(platformAuditLog).values({
        actorId: ctx.actorId,
        tenantId: tenant.id,
        action: "tenant.create",
        targetType: "tenant",
        targetId: tenant.id,
        detail: {
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          planKey: input.planKey,
          planName: plan.name,
          currency: input.currency,
          ...(input.gstin ? { gstin: input.gstin } : {}),
          locationName: input.locationName,
          locationIsPrimary: input.locationIsPrimary,
        },
      });

      return { kind: "ok", tenantId: tenant.id };
    });
  } catch (err) {
    // Postgres SQLSTATE 23505 = unique_violation. tenants.slug is
    // the only unique constraint that depends on operator input;
    // every other unique violation points to a logic bug we want to
    // see rather than swallow. Drizzle wraps the underlying pg
    // error as `cause` on its DrizzleError, while a pg.Pool'd query
    // bypass exposes the pg error directly. Walk the chain.
    if (isUniqueViolation(err)) {
      return {
        kind: "error",
        code: "slug_taken",
        message: `A tenant with slug "${input.slug}" already exists.`,
      };
    }
    throw err;
  }
}

// Drizzle prepared-query errors wrap the underlying pg error on
// `.cause`. Walk either a direct pg error or one wrapped by a
// Drizzle error, returning the SQLSTATE in `code`.
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur !== null && cur !== undefined; i++) {
    if (typeof cur === "object" && "code" in cur) {
      const code = (cur as { code?: unknown }).code;
      if (code === SLUG_TAKEN_PG_CODE) return true;
    }
    cur = (cur as { cause?: unknown } | null | undefined)?.cause;
  }
  return false;
}
