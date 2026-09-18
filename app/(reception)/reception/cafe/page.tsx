import { requireReception } from "@/lib/auth/surface-guard";
import { listMenuAction } from "@/lib/actions/menu";
import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { CafeOrderScreen } from "@/components/cafe-order-screen";

// K-07 — reception café counter. Menu reads ride settings.read
// (the receptionist holds it); recording, billing and payment ride
// payments.record on the K-02/K-03/K-04 actions. The page guard
// fails closed for every other surface.

export default async function ReceptionCafePage() {
  await requireReception();
  const [menu, locations, terminology] = await Promise.all([
    listMenuAction({}),
    listLocationsAction(),
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Café
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Take a counter order, bill it and record the payment.
      </p>
      <div className="mt-6">
        <CafeOrderScreen
          categories={menu.categories}
          items={menu.items}
          locations={locations}
          terminology={terminology}
        />
      </div>
    </main>
  );
}
