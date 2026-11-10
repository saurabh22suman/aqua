import { requireOwner } from "@/lib/auth/surface-guard";
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
// shared ThemeToggle is Foundation-owned and is not modified here; it
// still lives in the owner shell header.
//
// 3 November 2026 (Root review): the page no longer carries a purpose
// line. The device scope has ONE owner — the theme control's own
// "Saved on this device." — so the same sentence is not stated twice.
export default async function OwnerAppearancePage() {
  const ctx = await requireOwner();
  return (
    <OwnerPage>
      <PageHeader title="Appearance" />
      <div className="mt-5">
        <OwnerThemeChoice />
        <div className="mt-5">
          <OwnerArtwork
            mode="chooser"
            identity={{ tenantId: ctx.tenantId, userId: ctx.userId }}
          />
        </div>
      </div>
    </OwnerPage>
  );
}
