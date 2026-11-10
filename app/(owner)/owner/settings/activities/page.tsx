import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
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
  await requireLiveOwnerSettingsPage(ctx);
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
      <Link href="/owner/settings/academy" className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
        Next: Club profile &amp; GST
      </Link>
    </OwnerPage>
  );
}
