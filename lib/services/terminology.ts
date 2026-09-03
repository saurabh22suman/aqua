import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import type { ActionCtx } from "@/lib/auth/context";
import { asTenantId, type TenantId } from "@/lib/ids";
import {
  DEFAULT_LOCALE,
  TERM_KEYS,
  DEFAULT_TERMS,
  type Locale,
  type LocaleOverrides,
  type TermForms,
  type TermKey,
  type TerminologyOverrides,
  type TerminologyState,
} from "@/lib/terminology/keys";

// Phase 2.10 — terminology service.
//
// Stores per-tenant overrides in `tenants.terminology` (jsonb).
// The closed-key invariants (TERM_KEYS, one/other, per-locale)
// live in lib/terminology/keys.ts and are imported here. The
// storage shape matches the closed-key shape exactly; anything
// that doesn't match is rejected on write and ignored on read
// (a corrupted or legacy jsonb must never crash a tenant).
//
// Membership and class-of-tenant invariants on Ctx are still
// the authority for authorization; this service runs only on
// the tenant surface via withTenant() and inherits RLS.

const formsSchema: z.ZodType<TermForms> = z.object({
  one: z.string().trim().min(1).max(60),
  other: z.string().trim().min(1).max(60),
});

// The closed-key enum keeps the editor from accepting unknown
// keys at the service boundary; the action layer validates the
// form shape a second time. Parsing lives at every layer where
// untrusted input enters the system — the standing rule.
const localeOverridesSchema: z.ZodType<LocaleOverrides> = z.object({
  en: formsSchema.optional(),
});

const overridesSchema: z.ZodType<TerminologyOverrides> = z.object(
  Object.fromEntries(
    TERM_KEYS.map((k) => [k, localeOverridesSchema.optional()]),
  ) as Record<TermKey, z.ZodType<LocaleOverrides> | z.ZodOptional<z.ZodType<LocaleOverrides>>>,
);

const setInputSchema = z.object({
  key: z.enum(TERM_KEYS),
  locale: z.literal("en").default("en"),
  one: z.string().trim().min(1).max(60),
  other: z.string().trim().min(1).max(60),
});

export type UpdateTermOverrideInput = z.input<typeof setInputSchema>;

export type GetTerminologyResult = TerminologyState;

export type UpdateTermOverrideResult =
  | { kind: "ok"; terminology: TerminologyState }
  | { kind: "error"; code: "invalid"; message: string };

export type ClearTermOverrideResult =
  | { kind: "ok"; terminology: TerminologyState }
  | { kind: "error"; code: "invalid"; message: string };

// Stored shape — TS assumes the canonical shape, but a runtime
// guard validates it. Whatever wasn't one of the eight keys is
// dropped on read; per-locale entries that aren't 'en' (today)
// are also dropped. The tenant surface never throws on a
// partially-malformed jsonb.
function normaliseStored(raw: unknown): TerminologyOverrides {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, LocaleOverrides> = {};
  for (const k of Object.keys(obj)) {
    if (!TERM_KEYS.includes(k as TermKey)) continue;
    const value = obj[k];
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const en = v.en;
    if (!en || typeof en !== "object") continue;
    const forms = en as Record<string, unknown>;
    if (typeof forms.one !== "string" || forms.one.length === 0) continue;
    if (typeof forms.other !== "string" || forms.other.length === 0) continue;
    out[k] = {
      en: { one: forms.one, other: forms.other },
    };
  }
  return out as TerminologyOverrides;
}

async function readTerminologyFromTx(
  tx: TenantTx,
  tenantId: TenantId,
): Promise<TerminologyState> {
  const [row] = await tx
    .select({ terminology: tenants.terminology })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return {
    overrides: normaliseStored(row?.terminology),
    locale: DEFAULT_LOCALE,
  };
}

export async function getTerminology(
  ctx: Pick<ActionCtx, "tenantId">,
): Promise<GetTerminologyResult> {
  return withTenant(ctx.tenantId, (tx) =>
    readTerminologyFromTx(tx, asTenantId(ctx.tenantId)),
  );
}

export async function updateTermOverride(
  ctx: ActionCtx,
  rawInput: UpdateTermOverrideInput,
): Promise<UpdateTermOverrideResult> {
  const parsed = setInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const current = await readTerminologyFromTx(tx, asTenantId(ctx.tenantId));
    const keyOverrides: LocaleOverrides = {
      ...current.overrides[input.key],
      en: { one: input.one, other: input.other },
    };
    const merged: TerminologyOverrides = {
      ...current.overrides,
      [input.key]: keyOverrides,
    };

    // Validate the merged object against the closed-key schema
    // before writing — protects against a partially malformed
    // merge producing a row that fails to parse on the next
    // read. The action also parses the input; this is the
    // service-layer guarantee.
    const mergedValidation = overridesSchema.safeParse(merged);
    if (!mergedValidation.success) {
      return {
        kind: "error",
        code: "invalid",
        message: "Override conflicts with the closed term schema.",
      };
    }

    await tx
      .update(tenants)
      .set({
        terminology: mergedValidation.data,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    // TODO(tenant-audit-log): write a row to the tenant-side
    // audit table once it lands (architecture § 8.10).
    // updatedBy/updatedAt on tenants carries the actor until
    // then.
    const reloaded = await readTerminologyFromTx(tx, asTenantId(ctx.tenantId));
    return { kind: "ok", terminology: reloaded };
  });
}

export async function clearTermOverride(
  ctx: ActionCtx,
  rawInput: { key: TermKey; locale: Locale },
): Promise<ClearTermOverrideResult> {
  const parsed = z
    .object({ key: z.enum(TERM_KEYS), locale: z.literal("en") })
    .safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const current = await readTerminologyFromTx(tx, asTenantId(ctx.tenantId));
    const next: TerminologyOverrides = { ...current.overrides };
    if (next[input.key]) {
      const perLocale: LocaleOverrides = { ...next[input.key] };
      delete perLocale[input.locale];
      if (Object.keys(perLocale).length === 0) {
        delete next[input.key];
      } else {
        next[input.key] = perLocale;
      }
    }

    await tx
      .update(tenants)
      .set({
        terminology: next,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    const reloaded = await readTerminologyFromTx(tx, asTenantId(ctx.tenantId));
    return { kind: "ok", terminology: reloaded };
  });
}

// Default terms exposed for callers — the editor previews them
// when a key has no override. Kept in lib/terminology/keys.ts
// and re-exported here for the action layer's convenience.
export { DEFAULT_TERMS, TERM_KEYS };
