import Link from "next/link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listLocationsAction } from "@/lib/actions/people";
import { ActivityManager } from "@/components/activity-manager";

// Activity catalog (owner surface): what the club runs at each site —
// pool, court, table, café counter. Plans attach to activities next.

export default async function ActivitiesPage() {
  await requireOwner();
  const [locations, activities] = await Promise.all([
    listLocationsAction(),
    listActivitiesAction(),
  ]);

  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
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
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Facilities &amp; activities
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Each facility has its own activities — the pool, courts, tables
        and counter. Plans are priced per activity.
      </p>
      <div className="mt-5">
        <ActivityManager
          locations={locations.map((location) => ({
            id: location.id,
            name: location.name,
          }))}
          activities={activities}
        />
      </div>
    </main>
  );
}
