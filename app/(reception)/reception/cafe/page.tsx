import { requireReception } from "@/lib/auth/surface-guard";
import { listMenuAction } from "@/lib/actions/menu";
import { listLocationsAction } from "@/lib/actions/people";
import { listOpenCafeOrdersAction } from "@/lib/actions/orders";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { CafeOpenOrders } from "@/components/cafe-open-orders";
import { CafeOrderScreen } from "@/components/cafe-order-screen";

// K-07/K-08 — reception café counter and billing. Menu reads ride
// settings.read (the receptionist holds it); recording, billing and
// payment ride payments.record on the K-02/K-03/K-04 actions. The
// page guard fails closed for every other surface.
//
// K-08 splits the flow the owner asked for: pick an open order
// (placed / served / billed-unpaid) and request its bill, or start a
// new counter order. Either path shows the itemized amount due
// before the payment panel collects it.

export default async function ReceptionCafePage() {
  await requireReception();
  const [menu, locations, openOrders, terminology] = await Promise.all([
    listMenuAction({}),
    listLocationsAction(),
    listOpenCafeOrdersAction({}),
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Café
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Pick an open order to bill and collect, or start a new counter order.
      </p>
      <div className="mt-6 space-y-6">
        <CafeOpenOrders orders={openOrders} />
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
