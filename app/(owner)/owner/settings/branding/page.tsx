import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { BackLink } from "@/components/ui/BackLink";
import { getBrandingAction } from "@/lib/actions/branding";
import { BrandingForm } from "@/components/branding/branding-form";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import Link from "next/link";

// Owner branding editor for display name, short name, approved accent,
// logo and install icon, with a link to the club-specific install page.
export default async function BrandingSettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const data = await getBrandingAction();
  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />

      <PageHeader title={<>Branding</>} />
      <Link href={`/clubs/${ctx.tenantId}/install?source=staff`} className="mt-4 inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Install this club</Link>

      {/* Audit correction: the form owns the ONE live draft preview
          (mark + display name + selected accent). A page-level static
          preview competed with it on desktop, so the page composition
          keeps only the working form. */}
      {/* The page's own purpose line is gone: it only listed the fields the
          form already shows. The accent is a tenant branding value and
          still paints the academy mark — nothing here changes, resets or
          re-points it. */}
      <div className="mt-5 max-w-[700px]">
        <BrandingForm
          initial={{
            displayName: data.displayName ?? data.fallbackDisplayName,
            shortName: data.shortName ?? data.fallbackShortName,
            accent: data.accent,
            logoUrl: data.logoUrl,
          }}
        />
      </div>
    </OwnerPage>
  );
}
