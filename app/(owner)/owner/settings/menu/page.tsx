import Link from "next/link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listMenuAction } from "@/lib/actions/menu";
import { listLocationsAction } from "@/lib/actions/people";
import { MenuManager } from "@/components/menu-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// K-07 — owner menu management. Reads ride settings.read; every
// write goes through the K-01 actions gated on settings.manage
// (owner/admin only) — reception sees the counter menu, never this
// screen or its actions.

export default async function OwnerMenuPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  const [menu, locations] = await Promise.all([
    listMenuAction({}),
    listLocationsAction(),
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
        café menu
      </p>
      <PageHeader
        title={<>Café menu</>}
        purpose={<>Categories and items the counter sells, with price, GST rate
        and SAC code. Reception sees this menu at the café counter and
        cannot change it.</>}
      />
      <div className="mt-5">
        <MenuManager
          categories={menu.categories}
          items={menu.items}
          locations={locations}
        />
      </div>
    </OwnerPage>
  );
}
