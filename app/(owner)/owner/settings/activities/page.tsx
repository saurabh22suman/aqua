import Link from "next/link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listLocationsAction } from "@/lib/actions/people";
import { ActivityManager } from "@/components/activity-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// Activity catalog (owner surface): what the club runs at each site —
// pool, court, table, café counter. Plans attach to activities next.

export default async function ActivitiesPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  const [locations, activities] = await Promise.all([
    listLocationsAction(),
    listActivitiesAction(),
  ]);

  return (
    <OwnerPage className="max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/owner/settings"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Settings
        </Link>
        {" / "}
        activities
      </p>
      <PageHeader
        title={<>Activities &amp; resources</>}
        purpose={<>Each facility has its own activities — the pool, courts, tables
        and counter. Plans are priced per activity.</>}
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
    </OwnerPage>
  );
}
