import { requireOwner } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { listAdminLocationsAction } from "@/lib/actions/locations";
import { BackLink } from "@/components/ui/BackLink";
import { LocationManager } from "@/components/settings/location-manager";

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
  const locations = await listAdminLocationsAction();
  const multiLocation = locations.length > 1;

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/settings" label="Settings" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        {multiLocation ? "Locations" : "Academy location"}
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        {multiLocation
          ? "Each site's name, address and business hours. Staff and reports can be scoped per site."
          : "Your academy's name, address and business hours. Everything in Aqua implies this site until you add another."}
      </p>

      <LocationManager
        initial={locations}
        canWrite={hasPermission(ctx, "settings.manage")}
      />
    </main>
  );
}
