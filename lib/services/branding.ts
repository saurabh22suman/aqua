import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";
import { createHash } from "node:crypto";
import { prepareBrandingImage } from "@/lib/branding/prepare-image";
import { hasBrandingPngRow, replaceBrandingPng } from "@/lib/services/branding-png-store";
import { validAsset } from "@/lib/branding/asset-reference";
export { readBrandingLogo } from "@/lib/services/branding-asset-read";
export { prepareBrandingImage } from "@/lib/branding/prepare-image";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";
import { asTenantId, type TenantId } from "@/lib/ids";
import {
  ACCENT_KEYS,
  DEFAULT_ACCENT,
  deriveInitials,
  type AccentKey,
} from "@/lib/branding/accents";

export {
  ACCENTS,
  ACCENT_KEYS,
  DEFAULT_ACCENT,
  type AccentKey,
} from "@/lib/branding/accents";

// Phase 2.9 — branding service. The owner's three editable
// fields (display name, short name, accent) live in
// `tenants.branding` (jsonb), so adding more branding keys
// later is a column-shape change alone, not a migration.
//
// Logo and install-icon uploads are processed into PNGs and stored
// in tenant-scoped PostgreSQL. Bytes, references and audit records
// commit together; the initials fallback
// remains available when no logo has been uploaded.
//
// Architecture § 7.5 calls for an ACCENTS map frozen in code
// (six values, no free-text hex). The runtime-accent rule is
// enforced by a separate lint rule
// (tests/tier1/hardcoded-brand-color.test.ts) that bans
// `bg-mango`/etc. on the UI side; the resolver here is the
// guardrail on the data side. An unknown accent value MUST
// fall back to mango rather than throw — an unrecognised key
// from a partial deploy or a corrupted jsonb must never take
// down a tenant.

const inputSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  shortName: z.string().trim().min(1).max(40).optional(),
  accent: z.enum(ACCENT_KEYS as unknown as [AccentKey, ...AccentKey[]]).optional(),
}).strict();

export type UpdateBrandingInput = z.input<typeof inputSchema>;

export type BrandingData = {
  displayName: string | null;
  shortName: string | null;
  accent: AccentKey;
  // Resolved fallbacks — the UI uses these so a freshly-created
  // tenant (no branding yet) still has a usable name and
  // short-name-derived initials.
  fallbackDisplayName: string;
  fallbackShortName: string;
  // Initials derived from shortName (or fallbackShortName if
  // shortName is unset). Empty when even the fallback is empty
  // (only possible on a tenant with no usable name input).
  initials: string;
  logoUrl?: string | null;
};

export type UpdateBrandingResult =
  | { kind: "ok" }
  | { kind: "error"; code: "invalid"; message: string };

// JSONB stays loosely typed at the storage layer
// (Record<string, unknown>) but resolves to a typed shape at the
// service boundary. Anything missing or unrecognised becomes the
// documented fallback. Storing as loosely-typed jsonb is
// deliberate: adding a new branding key is a code change, never
// a schema migration.
type StoredBranding = {
  displayName?: unknown;
  shortName?: unknown;
  accent?: unknown;
  logo?: unknown;
  installIcon?: unknown;
};


function normaliseStored(raw: StoredBranding | null | undefined): {
  displayName: string | null;
  shortName: string | null;
  accent: AccentKey;
} {
  const obj = (raw ?? {}) as StoredBranding;
  return {
    displayName: typeof obj.displayName === "string" ? obj.displayName : null,
    shortName: typeof obj.shortName === "string" ? obj.shortName : null,
    accent:
      typeof obj.accent === "string" && (ACCENT_KEYS as readonly string[]).includes(obj.accent)
        ? (obj.accent as AccentKey)
        : DEFAULT_ACCENT,
  };
}

// Pure resolver from (tenant name, stored jsonb) to BrandingData.
// Exported for callers that already hold the tenants row inside their
// own withTenant (the receipt renderer, C-39) and must not open a
// second scope — withTenant cannot nest (db/scope.ts).
export function brandDataFrom(tenantName: string, raw: unknown): BrandingData {
  const stored = normaliseStored(raw as StoredBranding);

  // Fallbacks: shortName from the tenant name's first word if a
  // shortName hasn't been set; same for displayName. Strips
  // punctuation so "Salt-Lake" still reads as "Salt Lake" in the
  // initials derivation below.
  const fallbackShortName = tenantName.split(/\s+/).filter(Boolean)[0] ?? "";
  const fallbackDisplayName = tenantName;

  const initialSource = stored.shortName ?? fallbackShortName;
  const initials = deriveInitials(initialSource);

  return {
    displayName: stored.displayName,
    shortName: stored.shortName,
    accent: stored.accent,
    fallbackDisplayName,
    fallbackShortName,
    initials,
  };
}

// Shared between getBranding (read) and updateBranding (write)
// — the latter wants the post-merge values without opening a
// second withTenant (those cannot nest, see db/scope.ts).
async function readBrandingFromTx(
  tx: TenantTx,
  tenantId: TenantId,
): Promise<BrandingData> {
  const [row] = await tx
    .select({
      tenantName: tenants.name,
      branding: tenants.branding,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const brand = brandDataFrom(row?.tenantName ?? "", row?.branding);
  const raw = (row?.branding ?? {}) as StoredBranding;
  const logo = validAsset(raw.logo, tenantId, "logo");
  return { ...brand, logoUrl: logo ? `/clubs/${tenantId}/branding/logo/${logo.sha256}?source=staff` : null };
}

export async function getBranding(
  ctx: Pick<ActionCtx, "tenantId">,
): Promise<BrandingData> {
  return withTenant(ctx.tenantId, (tx) =>
    readBrandingFromTx(tx, asTenantId(ctx.tenantId)),
  );
}

export async function updateBranding(
  ctx: ActionCtx,
  rawInput: UpdateBrandingInput,
): Promise<UpdateBrandingResult> {
  // Parse here as well as in the Server Action — the service is
  // the only sanctioned writer, including any future platform-side
  // path, and the invariant belongs at the writer, not the caller.
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) {
      return { kind: "error", code: "invalid", message: "Only the academy owner can change this setting." };
    }
    const [existing] = await tx
      .select({ branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .for("update");
    const rawBranding = (existing?.branding ?? {}) as StoredBranding;
    const merged = normaliseStored(
      (existing?.branding ?? {}) as StoredBranding,
    );
    const before = {
      displayName: merged.displayName,
      shortName: merged.shortName,
      accent: merged.accent,
    };
    if (input.displayName !== undefined) merged.displayName = input.displayName;
    if (input.shortName !== undefined) merged.shortName = input.shortName;
    if (input.accent !== undefined) merged.accent = input.accent;
    const after = {
      displayName: merged.displayName,
      shortName: merged.shortName,
      accent: merged.accent,
    };
    const changedFields = (
      ["displayName", "shortName", "accent"] as const
    ).filter((key) => before[key] !== after[key]);

    await tx
      .update(tenants)
      .set({
        branding: { ...after, ...(rawBranding.logo !== undefined ? { logo: rawBranding.logo } : {}), ...(rawBranding.installIcon !== undefined ? { installIcon: rawBranding.installIcon } : {}) },
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    // E-02 — standing rule: the mutation and its audit row commit
    // together. before/after are the branding jsonb sub-keys (no
    // secrets live in it); changedFields carries only the keys the
    // caller actually moved.
    await writeAudit(tx, {
      tenantId: asTenantId(ctx.tenantId),
      actorType: "staff",
      actorId: ctx.userId ?? null,
      action: "branding.update",
      entityType: "tenant",
      entityId: ctx.tenantId,
      before,
      after,
      changedFields: changedFields.length > 0 ? changedFields : null,
      requestId: ctx.requestId ?? null,
    });

    return { kind: "ok" } as const;
  });
}

/** Replace the tenant's current PNG, reference and audit atomically. */
export async function uploadBrandingAsset(input: {
  ctx: ActionCtx;
  kind: "logo" | "install_icon";
  bytes: Uint8Array;
  mime: string;
}): Promise<{ ok: boolean }> {
  const { ctx, kind } = input;
  if (!ctx.userId || (kind !== "logo" && kind !== "install_icon")) return { ok: false };
  const authorized = await withTenant(ctx.tenantId, (tx) => callerIsLiveOwnerForSettingsOrDelegation(tx, ctx));
  if (!authorized) return { ok: false };
  const image = await prepareBrandingImage(input);
  if (!image.ok) return { ok: false };
  const sha256 = createHash("sha256").update(image.png).digest("hex");
  const objectKey = `tenant-branding/${ctx.tenantId}/${kind}/${sha256}.png`;
  try { return await withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) return { ok: false };
    const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for("update");
    if (!row) return { ok: false };
    const raw = (row.branding ?? {}) as StoredBranding;
    const previous = normaliseStored(raw);
    const logo = validAsset(raw.logo, ctx.tenantId, "logo");
    const installIcon = validAsset(raw.installIcon, ctx.tenantId, "install_icon");
    // Never replace or discard an unmigrated or malformed legacy reference.
    if ((raw.logo != null && (!logo || !(await hasBrandingPngRow(tx, ctx.tenantId, "logo", logo.sha256)))) ||
        (raw.installIcon != null && (!installIcon || !(await hasBrandingPngRow(tx, ctx.tenantId, "install_icon", installIcon.sha256))))) return { ok: false };
    const field = kind === "logo" ? "logo" : "installIcon";
    const next = { ...previous, ...(logo ? { logo } : {}), ...(installIcon ? { installIcon } : {}), [field]: { objectKey, sha256, contentType: "image/png" } };
    await replaceBrandingPng(tx, ctx.tenantId, kind, sha256, image.png);
    await tx.update(tenants).set({ branding: next, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
    await writeAudit(tx, { tenantId: asTenantId(ctx.tenantId), actorType: "staff", actorId: ctx.userId ?? null, action: "branding.asset.update", entityType: "tenant", entityId: ctx.tenantId, before: { [field]: kind === "logo" ? logo : installIcon }, after: { [field]: next[field] }, changedFields: [field], requestId: ctx.requestId ?? null });
    return { ok: true };
  }); } catch { return { ok: false }; }
}
