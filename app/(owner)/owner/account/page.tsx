import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkspaceRoleSwitch } from "@/components/settings/workspace-role-switch";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { requireOwner } from "@/lib/auth/surface-guard";
import { readStaffWorkspaceRoles } from "@/lib/auth/workspace-roles";
import { OwnerLink } from "@/components/owner-ui/owner-link";
import { buttonClasses } from "@/components/ui/Button";

export default async function AccountPage() {
  const ctx = await requireOwner();
  const options = await readStaffWorkspaceRoles(ctx).catch(() => undefined);

  return (
    <OwnerPage workflow="settings">
      <PageHeader title="Account" />
      <div className="mt-4 max-w-md space-y-3">
        <WorkspaceRoleSwitch options={options} settingsHref="/owner/account" />
        <OwnerLink href="/owner/settings/appearance" className={buttonClasses({ variant: "secondary" })}>Appearance</OwnerLink>
        <TenantSignOut showClubSwitch={options?.showBusinessSwitch ?? false} />
      </div>
    </OwnerPage>
  );
}
