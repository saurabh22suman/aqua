import type { Metadata } from "next";
import { guidePreferenceKey } from "@/components/onboarding/guide-preference-key";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { WorkspaceRoleSwitch } from "@/components/settings/workspace-role-switch";
import { StaffAccountLinks } from "@/components/staff-ui/staff-account-links";
import { StaffAppearance } from "@/components/staff-ui/staff-appearance";
import { StaffIdentity, StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { requireWorkerPage } from "@/lib/auth/worker-page";
import { readStaffWorkspaceRoles } from "@/lib/auth/workspace-roles";
import { getCurrentStaffIdentity } from "@/lib/services/staff";

export const metadata: Metadata = { title: { absolute: "Me · Aqua" } };

export default async function WorkerMePage() {
  const ctx = await requireWorkerPage();
  const [identity, roleOptions] = await Promise.all([
    getCurrentStaffIdentity(ctx).catch(() => null),
    readStaffWorkspaceRoles(ctx).catch(() => undefined),
  ]);
  const guideKey = guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey);

  return (
    <StaffPage>
      <StaffPageHeader title="Me" />
      <StaffIdentity name={identity?.fullName} phone={identity?.phone} />
      <StaffAppearance />
      <StaffAccountLinks tenantId={ctx.tenantId} guideHref="/worker/me" />
      <WorkspaceRoleSwitch options={roleOptions} settingsHref="/worker/me" className="mt-4" />
      <TenantSignOut showClubSwitch={roleOptions?.showBusinessSwitch ?? false} />
      <OptionalWorkspaceGuide
        key={guideKey}
        startCollapsed
        preferenceKey={guideKey}
        title="Explore your workday"
        regionLabel="Optional worker guide"
        itemLabel="Page feature"
        items={[
          { key: "shifts", title: "Schedule", detail: "Find your published shifts." },
          { key: "attendance", title: "Today", detail: "Check in or out from Today." },
          { key: "leave", title: "Leave", detail: "Open Leave from Schedule to manage requests." },
        ]}
      />
    </StaffPage>
  );
}
