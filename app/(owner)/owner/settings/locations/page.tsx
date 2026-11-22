import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { listAdminLocationsAction } from "@/lib/actions/locations";
import { BackLink } from "@/components/ui/BackLink";
import { LocationManager } from "@/components/settings/location-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";

// U-07 — owner locations and business hours. The schema's locations
// table is the O-01 hierarchy's top node; this editor covers name,
// kind and address, and delegates business hours to the config
// registry (operations.business_hours, location scope).
//
// Single-location rule (ops-platform-design §"Single-site owners must
// never see the concept"): with one location the heading stays
// singular and no switcher or "all locations" control is rendered.
// The add form remains, because adding the second location is what
// makes the concept visible in the first place.

export default async function LocationsSettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const locations = await listAdminLocationsAction();
  const multiLocation = locations.length > 1;

  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>{multiLocation ? "Physical facilities" : "Physical facility"}</>}
        purpose={<>{locations.length === 0
          ? "No physical facilities yet. Add a physical facility to get started."
          : multiLocation
            ? "Each physical facility is a site; staff and reports can be scoped per site."
            : "This is your physical site. You can add another facility below."}</>}
      />

      <LocationManager
        initial={locations}
        canWrite={hasPermission(ctx, "settings.manage")}
      />
      <Link href="/owner/settings/activities" className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
        Next: Sports resources
      </Link>
    </OwnerPage>
  );
}
