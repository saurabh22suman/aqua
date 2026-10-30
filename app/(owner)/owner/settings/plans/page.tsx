import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import {
  listPlanTemplatesAction,
  listPlansAction,
} from "@/lib/actions/membership-plans";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listLocationsAction } from "@/lib/actions/people";
import { PlanManager } from "@/components/plan-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// C-29 — owner surface for membership plans: preset templates become
// sellable plans once priced; custom plans can be added directly.
// Plan mutations require settings.manage (the actions enforce it);
// the page 404s for a caller without the grant so the accountant,
// who shares the owner surface, is never shown the management forms.

export default async function PlansPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  if (!hasPermission(ctx, "settings.manage")) notFound();
  const [templates, plans, locations, activities] = await Promise.all([
    listPlanTemplatesAction(),
    listPlansAction(),
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
        plans
      </p>
      <PageHeader
        title={<>Membership plans</>}
        purpose={<>What the academy sells: durations, session packs and one-time
        plans. Subscriptions are started from a member&apos;s page.</>}
      />
      <div className="mt-5">
        <PlanManager
          templates={templates}
          plans={plans}
          locations={locations}
          activities={activities.map((activity) => ({
            id: activity.id,
            name: activity.name,
            locationId: activity.locationId,
          }))}
        />
      </div>
    </OwnerPage>
  );
}
