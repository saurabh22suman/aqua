import Link from "next/link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { listMenuAction } from "@/lib/actions/menu";
import { listLocationsAction } from "@/lib/actions/people";
import { MenuManager } from "@/components/menu-manager";

// K-07 — owner menu management. Reads ride settings.read; every
// write goes through the K-01 actions gated on settings.manage
// (owner/admin only) — reception sees the counter menu, never this
// screen or its actions.

export default async function OwnerMenuPage() {
  await requireOwner();
  const [menu, locations] = await Promise.all([
    listMenuAction({}),
    listLocationsAction(),
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
        café menu
      </p>
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Café menu
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Categories and items the counter sells, with price, GST rate
        and SAC code. Reception sees this menu at the café counter and
        cannot change it.
      </p>
      <div className="mt-5">
        <MenuManager
          categories={menu.categories}
          items={menu.items}
          locations={locations}
        />
      </div>
    </main>
  );
}
