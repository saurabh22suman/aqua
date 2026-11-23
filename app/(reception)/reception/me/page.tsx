import { StaffWorkdayLink } from "@/components/staff-ui/staff-workday-link";
import { StaffInboxLink } from "@/components/announcements/staff-inbox-link";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { readStaffWorkspaceRoles } from "@/lib/auth/workspace-roles";
import { WorkspaceRoleSwitch } from "@/components/settings/workspace-role-switch";
import { requireReception } from "@/lib/auth/surface-guard";
import {
  StaffIdentity,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";
import { StaffAppearance } from "@/components/staff-ui/staff-appearance";
import { StaffAccountLinks } from "@/components/staff-ui/staff-account-links";

export default async function ReceptionMePage() {
  await requireReception();
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  const [identity, roleOptions] = await Promise.all([
    getCurrentStaffIdentity(ctx).catch(() => null),
    readStaffWorkspaceRoles(ctx).catch(() => undefined),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader title="Me" />

      <StaffIdentity name={identity?.fullName} phone={identity?.phone} />

      <StaffWorkdayLink ctx={ctx} href="/reception/workday" />

      <StaffInboxLink href="/reception/announcements" />

      <StaffAppearance />

      <StaffAccountLinks tenantId={ctx.tenantId} guideHref={ctx.roleKey === "receptionist" ? "/reception" : undefined} />
      <WorkspaceRoleSwitch options={roleOptions} settingsHref="/reception/me" className="mt-4" />
      <TenantSignOut showClubSwitch={roleOptions?.showBusinessSwitch ?? false} />
    </StaffPage>
  );
}
