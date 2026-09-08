import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import {
  DEFAULT_ACCENT,
  deriveInitials,
  isAccentKey,
  type AccentKey,
} from "@/lib/branding/accents";
import type { ActionCtx } from "@/lib/auth/context";

// §5.2 — what the member identity card needs from the tenant:
//   - slug (public disambiguator — the QR payload includes it)
//   - display name (shown on the card itself)
//   - accent (drives the mark colour via TenantMark)
//   - initials (TenantMark fallback when no logo — logo upload is
//     unbuilt; see branding service note)
//
// Lives next to the branding service because it is effectively a
// subset of branding for the card surface. Not on BrandingData
// itself because the slug is not "branding" — it's identity —
// and keeping it separate keeps BrandingData's contract clean.
export type MemberIdCardContext = {
  tenantSlug: string;
  displayName: string;
  accent: AccentKey;
  initials: string;
};

export async function getMemberIdCardContext(
  ctx: Pick<ActionCtx, "tenantId">,
): Promise<MemberIdCardContext | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        slug: tenants.slug,
        fallbackName: tenants.name,
        branding: tenants.branding,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    if (!row) return null;

    const raw = (row.branding ?? {}) as Record<string, unknown>;
    const brandedShortName = typeof raw.shortName === "string" ? raw.shortName : "";
    const brandedDisplayName = typeof raw.displayName === "string" ? raw.displayName : "";
    const accent: AccentKey = isAccentKey(raw.accent) ? raw.accent : DEFAULT_ACCENT;

    // Display name: the branded override, falling back to the
    // tenant's stored name. Initials come from the short-name-derived
    // string (branded override or the tenant name itself).
    const shortNameSource = brandedShortName || row.fallbackName || "";
    const displayName = brandedDisplayName || row.fallbackName || "";

    return {
      tenantSlug: row.slug,
      displayName,
      accent,
      initials: deriveInitials(shortNameSource),
    };
  });
}
