import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listLocationsAction } from "@/lib/actions/people";
import { ActivityManager } from "@/components/activity-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";

// Activity catalog (owner surface): what the club runs at each site —
// pool, court, table, café counter. Plans attach to activities next.

export default async function ActivitiesPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const [locations, activities] = await Promise.all([
    listLocationsAction(),
    listActivitiesAction(),
  ]);

  return (
    <OwnerPage workflow="settings" className="max-w-2xl">
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Sports resources</>}
        purpose={<>Each entry is one resource, such as a pool, court or table,
        at a physical facility. Give each resource a name, type and capacity.</>}
      />
      <div className="mt-5">
        <ActivityManager
          locations={locations.map((location) => ({
            id: location.id,
            name: location.name,
          }))}
          activities={activities}
        />
      </div>
      {/* Resources are the prerequisite for both priced catalogues. The
          page names the two real next tasks instead of sending the owner
          back to their profile. */}
      <nav aria-label="Next steps" className="mt-5 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-4">
        <Link href="/owner/settings/plans" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
          Next: Membership plans
        </Link>
        <Link href="/owner/settings/booking-prices" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
          Next: Booking slot prices
        </Link>
      </nav>
    </OwnerPage>
  );
}
