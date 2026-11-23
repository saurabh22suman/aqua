import { requireOwner } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerArtwork } from "@/components/owner-artwork/owner-artwork";
import { OwnerThemeChoice } from "@/components/settings/owner-theme-choice";

// Owner appearance settings.
//
// 3 November 2026: the page offered only the shared icon-only theme
// toggle, whose preset name is hidden below the `sm` breakpoint, so the
// two approved light presets were invisible on a phone. The theme is now
// an explicit, named choice on this page.
//
// The page keeps both halves it always had — the display preset and the
// artwork chooser — and stays a personal, per-device preference. The
// shared ThemeToggle stays Foundation-owned in behaviour; the courtside
// label flag is opt-in, and the owner shell header can opt in by
// passing the same flag.
//
// 3 November 2026 (Root review): the page no longer carries a purpose
// line. The device scope has ONE owner — the theme control's own
// "Saved on this device." — so the same sentence is not stated twice.
//
export default async function OwnerAppearancePage() {
  const ctx = await requireOwner();
  return (
    <OwnerPage workflow="settings">
      <BackLink href="/owner/settings" label="Settings" />
      {/* The settings hub names this destination "Theme & artwork"; the
          page uses the same words so the destination is recognisable. */}
      <PageHeader title="Theme & artwork" />
      <div className="mt-5">
        <OwnerThemeChoice courtside={ctx.roleKey === "owner"} />
        <details className="mt-5 rounded-card border border-line bg-paper p-3">
          <summary className="min-h-11 cursor-pointer content-center px-1 text-sm font-medium">Collection artwork preference</summary>
          <OwnerArtwork
            mode="chooser"
            identity={{ tenantId: ctx.tenantId, userId: ctx.userId }}
          />
        </details>
      </div>
    </OwnerPage>
  );
}
