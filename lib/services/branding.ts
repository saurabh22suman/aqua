import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
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
// Marks (wordmark / square mark uploads) are intentionally NOT
// in this service yet. The 2.9 Done When — "a tenant with no
// upload still renders a correct mark everywhere" — is met by
// the inline-SVG initials fallback in components/branding/, no
// upload path required. The upload path itself needs the R2
// client (F-17's setup, also referenced by C-07 documents) — a
// dependency question, raised separately and not in this PR.
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
});

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
  const tenantName = row?.tenantName ?? "";
  const stored = normaliseStored(row?.branding as StoredBranding);

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
    const [existing] = await tx
      .select({ branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const merged = normaliseStored(
      (existing?.branding ?? {}) as StoredBranding,
    );
    if (input.displayName !== undefined) merged.displayName = input.displayName;
    if (input.shortName !== undefined) merged.shortName = input.shortName;
    if (input.accent !== undefined) merged.accent = input.accent;

    await tx
      .update(tenants)
      .set({
        branding: {
          displayName: merged.displayName,
          shortName: merged.shortName,
          accent: merged.accent,
        },
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    // TODO(tenant-audit-log): write to tenants' audit table here
    // (architecture § 8.10) once it exists. The platform-side
    // service layer writes to platform_audit_log; the tenant-side
    // analogue is unbuilt and the standing rule's "every mutation
    // writes audit in the same transaction" applies to it when it
    // lands. Until then, updatedBy/updatedAt on the row itself
    // carry the actor and timestamp.
    return { kind: "ok" } as const;
  });
}
