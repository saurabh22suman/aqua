import { BackLink } from "@/components/ui/BackLink";
import { getBrandingAction } from "@/lib/actions/branding";
import { BrandingForm } from "@/components/branding/branding-form";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// Phase 2.9 — owner branding editor. Setting display name and
// short name, and choosing an accent from the six approved
// values. Logo and mark upload is intentionally out of scope —
// see the PR description and docs/five-day-work-guide.md
// (no new dependency without asking).
export default async function BrandingSettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  const data = await getBrandingAction();
  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />

      <PageHeader
        title={<>Branding</>}
        purpose={<>The display name, short name and accent that show across the academy.</>}
      />

      {/* Audit correction: the form owns the ONE live draft preview
          (mark + display name + selected accent). A page-level static
          preview competed with it on desktop, so the page composition
          keeps only the working form. */}
      <div className="mt-5 max-w-[700px]">
        <BrandingForm
          initial={{
            displayName: data.displayName ?? data.fallbackDisplayName,
            shortName: data.shortName ?? data.fallbackShortName,
            accent: data.accent,
          }}
        />
      </div>
    </OwnerPage>
  );
}
