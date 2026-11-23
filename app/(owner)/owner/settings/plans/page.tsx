import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
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
import { BackLink } from "@/components/ui/BackLink";
import { SettingsPrerequisite } from "@/components/settings/settings-states";

// C-29 — owner surface for membership plans: preset templates become
// sellable plans once priced; custom plans can be added directly.
// Plan mutations require settings.manage (the actions enforce it);
// the page 404s for a caller without the grant so the accountant,
// who shares the owner surface, is never shown the management forms.

export default async function PlansPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  if (!hasPermission(ctx, "settings.manage")) notFound();
  const [templates, plans, locations, activities] = await Promise.all([
    listPlanTemplatesAction(),
    listPlansAction(),
    listLocationsAction(),
    listActivitiesAction(),
  ]);

  return (
    <OwnerPage workflow="settings" className="max-w-2xl">
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Membership plans</>}
        purpose={<>The priced plans a member can subscribe to. Subscriptions are started from a member&apos;s page.</>}
      />
      {/* A plan is attached to a site, so a plan cannot be priced before a
          site exists. Send the owner to the task that unblocks this one. */}
      {locations.length === 0 ? (
        <SettingsPrerequisite
          title="No physical facility yet"
          body="A membership plan is attached to a site. Add a physical facility before pricing plans."
          actionLabel="Add a physical facility"
          actionHref="/owner/settings/locations"
        />
      ) : null}
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
