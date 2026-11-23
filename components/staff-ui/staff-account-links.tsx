import { OpenWorkspaceGuideLink } from "@/components/onboarding/guide-help-button";
import { StaffClubInstallLink } from "@/components/staff-club-install-link";

export function StaffAccountLinks({ tenantId, guideHref }: { tenantId: string; guideHref?: string }) {
  return (
    <nav aria-label="Account resources" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <StaffClubInstallLink tenantId={tenantId} />
      {guideHref ? <OpenWorkspaceGuideLink homeHref={guideHref} /> : null}
    </nav>
  );
}
