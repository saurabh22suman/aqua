import { StaffWorkdayLink } from "@/components/staff-ui/staff-workday-link";
import { StaffInboxLink } from "@/components/announcements/staff-inbox-link";
import { requireDefaultCtx } from "@/lib/auth/context";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { requireCoach } from "@/lib/auth/surface-guard";
import { readStaffWorkspaceRoles } from "@/lib/auth/workspace-roles";
import { WorkspaceRoleSwitch } from "@/components/settings/workspace-role-switch";
import { hasPermission } from "@/lib/auth/permission";
import Link from "next/link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import {
  STAFF_CARD,
  StaffIdentity,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";
import { StaffAppearance } from "@/components/staff-ui/staff-appearance";
import { StaffAccountLinks } from "@/components/staff-ui/staff-account-links";

export default async function CoachMePage() {
  await requireCoach();
  const ctx = await requireDefaultCtx();
  const [identity, roleOptions] = await Promise.all([
    getCurrentStaffIdentity(ctx).catch(() => null),
    readStaffWorkspaceRoles(ctx).catch(() => undefined),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader title="Me" />

      <StaffIdentity name={identity?.fullName} phone={identity?.phone} />

      <StaffWorkdayLink ctx={ctx} href="/coach/workday" />

      <StaffInboxLink href="/coach/announcements" />

      {/* R02 — the designated curriculum lead's editing surface entry.
          Ordinary coaches do not hold levels.write, so this card is
          invisible to them. */}
      {hasPermission(ctx, "levels.write") ? (
        <Link
          href="/coach/curriculum"
          className={`mt-4 flex min-h-14 items-center gap-3 px-4 py-3 ${STAFF_CARD}`}
          data-testid="coach-curriculum-link"
        >
          <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
            <OwnerIcon name="programs" size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium leading-tight text-ink">
              Curriculum framework
            </span>
            <span className="mt-0.5 block text-[12px] leading-tight text-ink-3">
              Levels, skills and the four-band rubric you assess against.
            </span>
          </span>
          <OwnerIcon name="chevron" size={18} className="flex-none text-ink-3" />
        </Link>
      ) : null}

      <StaffAppearance />

      <StaffAccountLinks tenantId={ctx.tenantId} guideHref={ctx.roleKey === "coach" ? "/coach" : undefined} />
      <WorkspaceRoleSwitch options={roleOptions} settingsHref="/coach/me" className="mt-4" />
      <TenantSignOut showClubSwitch={roleOptions?.showBusinessSwitch ?? false} />
    </StaffPage>
  );
}
