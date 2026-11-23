import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { withTenant } from "@/db/tenant";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerDefaultFacilityForm } from "@/components/settings/owner-default-facility-form";
import { listLocations } from "@/lib/services/people";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import { ownerDefaultFacilityKey } from "@/lib/services/workspace-opening";

export default async function OwnerWorkspaceSettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "dashboard.view");
  if (!ctx.features.has("reports")) notFound();
  const [locations, access, store] = await Promise.all([
    listLocations(ctx),
    withTenant(ctx.tenantId, (tx) => resolveLocationAccess(tx, ctx)),
    cookies(),
  ]);
  const facilities = locations.filter(({ id }) => locationVisible(access, id));
  const saved = store.get(ownerDefaultFacilityKey(ctx))?.value;
  const selected = facilities.find(({ id }) => id === saved)?.id ?? "all";

  return (
    <OwnerPage workflow="settings">
      <BackLink href="/owner/settings" label="Settings" />
      {/* The settings hub offers this as "Default facility"; using the
          same name makes the destination recognisable. */}
      <PageHeader title="Default facility" />
      <OwnerDefaultFacilityForm selected={selected} facilities={facilities} />
    </OwnerPage>
  );
}
