import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listMenuAction } from "@/lib/actions/menu";
import { listLocationsAction } from "@/lib/actions/people";
import { MenuManager } from "@/components/menu-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { SettingsPrerequisite } from "@/components/settings/settings-states";

// K-07 — owner menu management. Reads ride settings.read; every
// write goes through the K-01 actions gated on settings.manage
// (owner/admin only) — reception sees the counter menu, never this
// screen or its actions.

export default async function OwnerMenuPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const [menu, locations] = await Promise.all([
    listMenuAction({}),
    listLocationsAction(),
  ]);

  return (
    <OwnerPage workflow="settings" className="max-w-2xl">
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Café menu</>}
        purpose={<>Every item carries a price, a GST rate and a SAC code.
        Reception sees this menu at the café counter and cannot change
        it.</>}
      />
      {/* A menu category belongs to a site. An academy with no site cannot
          finish this task, so name the prerequisite and the way to fix it. */}
      {locations.length === 0 ? (
        <SettingsPrerequisite
          title="No physical facility yet"
          body="The café menu is attached to a site. Add a physical facility before building the menu."
          actionLabel="Add a physical facility"
          actionHref="/owner/settings/locations"
        />
      ) : null}
      <div className="mt-5">
        <MenuManager
          categories={menu.categories}
          items={menu.items}
          locations={locations}
          taskSheet={ctx.roleKey === "owner"}
        />
      </div>
    </OwnerPage>
  );
}
