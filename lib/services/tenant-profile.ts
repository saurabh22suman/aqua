import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { writeAudit } from "@/lib/audit/write";
import { GSTIN_RE } from "@/lib/gst";
import type { ActionCtx } from "@/lib/auth/context";

// PR2-C1 — academy profile settings. Name, currency, timezone and
// GSTIN are the tenant's identity fields; before this service the only
// way to fix a typo'd GSTIN was a platform operator or a migration.
//
// The GSTIN snapshot rule is untouched: invoices store their own
// `gstin` at issue time (lib/services/invoice-issue.ts), so editing
// the profile never rewrites an issued document.

export type TenantProfile = {
  name: string;
  currency: string;
  timezone: string;
  gstin: string | null;
};

export type UpdateTenantProfileResult =
  | { kind: "ok" }
  | { kind: "error"; code: "invalid" | "not_found"; message: string };

// Same construction as the ops create form: a DateTimeFormat with the
// candidate zone throws RangeError for an unknown identifier, which is
// the exact path every "show this in tenant-local time" conversion uses.
function isCanonicalTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "Academy name can't be empty.").max(200).optional(),
  currency: z
    .string()
    .trim()
    .length(3, "Currency must be a 3-letter ISO 4217 code.")
    .regex(/^[A-Z]{3}$/, "Currency must be uppercase letters.")
    .optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .refine(isCanonicalTimezone, "Time zone is not a recognised IANA identifier.")
    .optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine(
      (value) => value === undefined || value === "" || GSTIN_RE.test(value),
      "GSTIN format is invalid.",
    ),
});

export async function getTenantProfile(
  ctx: Pick<ActionCtx, "tenantId">,
): Promise<TenantProfile | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        name: tenants.name,
        currency: tenants.currency,
        timezone: tenants.timezone,
        gstin: tenants.gstin,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function updateTenantProfile(
  ctx: ActionCtx,
  raw: unknown,
): Promise<UpdateTenantProfileResult> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  if (!ctx.userId) {
    return { kind: "error", code: "invalid", message: "Not authenticated." };
  }
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        name: tenants.name,
        currency: tenants.currency,
        timezone: tenants.timezone,
        gstin: tenants.gstin,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const current = rows[0];
    if (!current) {
      return { kind: "error", code: "not_found", message: "Academy not found." };
    }

    const changes: Partial<typeof tenants.$inferInsert> = {};
    const changedFields: string[] = [];

    if (input.name !== undefined && input.name !== current.name) {
      changes.name = input.name;
      changedFields.push("name");
    }
    if (input.currency !== undefined && input.currency !== current.currency) {
      changes.currency = input.currency;
      changedFields.push("currency");
    }
    if (input.timezone !== undefined && input.timezone !== current.timezone) {
      changes.timezone = input.timezone;
      changedFields.push("timezone");
    }
    if (input.gstin !== undefined) {
      const next = input.gstin === "" ? null : input.gstin;
      if (next !== current.gstin) {
        changes.gstin = next;
        changedFields.push("gstin");
      }
    }

    if (changedFields.length === 0) return { kind: "ok" };

    changes.updatedBy = ctx.userId;
    changes.updatedAt = new Date();
    await tx
      .update(tenants)
      .set(changes)
      .where(eq(tenants.id, ctx.tenantId));

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "tenant.profile.update",
      entityType: "tenant",
      entityId: ctx.tenantId,
      before: current,
      after: {
        name: changes.name ?? current.name,
        currency: changes.currency ?? current.currency,
        timezone: changes.timezone ?? current.timezone,
        gstin: changes.gstin !== undefined ? changes.gstin : current.gstin,
      },
      changedFields,
    });

    return { kind: "ok" };
  });
}
