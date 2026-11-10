import {
  requirePagePermission,
  requireReception,
} from "@/lib/auth/surface-guard";
import { hasFeature } from "@/lib/auth/permission";
import { listMenuAction } from "@/lib/actions/menu";
import { listLocationsAction } from "@/lib/actions/people";
import { listOpenCafeOrdersAction } from "@/lib/actions/orders";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { CafeOpenOrders } from "@/components/cafe-open-orders";
import { CafeOrderScreen } from "@/components/cafe-order-screen";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

// K-07/K-08 — reception café counter and billing. Menu reads ride
// settings.read (the receptionist holds it); recording, billing and
// payment ride payments.record on the K-02/K-03/K-04 actions. The
// page guard fails closed for every other surface.
//
// K-08 splits the flow the owner asked for: pick an open order
// (placed / served / billed-unpaid) and request its bill, or start a
// new counter order. Either path shows the itemized amount due
// before the payment panel collects it.
//
// The café ENTITLEMENT decides the NEW half only. `cafe.pos` is a
// separately-entitled module that the standard plan does not carry, and
// the server action already refuses to create a NEW counter order while
// it is off. This page must not offer a counter it cannot honour:
// with the entitlement off the new-order screen is gone, and the page
// says so in words. The HISTORICAL half stays: an order that already
// exists remains listed, billable and collectable, exactly as the
// human policy requires ("disabled Café/Bookings blocks NEW module
// work but authorised historical billing stays available"). The page
// is therefore never a blanket 404 for a café the club has switched
// off — only for a caller without payments.record.
export default async function ReceptionCafePage() {
  const ctx = await requireReception();
  // R07 page-guard rule: a caller without payments.record may not read
  // the open orders either, so the page fails closed before any read.
  requirePagePermission(ctx, "payments.record");
  const canStartNewOrder = hasFeature(ctx, "cafe.pos");

  const [openOrders, terminology] = await Promise.all([
    listOpenCafeOrdersAction({}),
    getTerminologyAction(),
  ]);
  // The menu is only needed by the new-order screen, so it is not read
  // at all when the café module is off.
  const menu = canStartNewOrder ? await listMenuAction({}) : null;
  const locations = canStartNewOrder ? await listLocationsAction() : null;

  return (
    <StaffPage className="max-w-xl">
      {/* The scope line names what the page does. When the café is off,
          the ONE visible owner of the explanation is the notice below —
          the header must not say the same thing twice, side by side. */}
      <StaffPageHeader
        title="Café"
        meta={
          canStartNewOrder
            ? "Pick an open order to bill and collect, or start a new counter order."
            : undefined
        }
      />
      <div className="mt-6 space-y-6">
        {canStartNewOrder ? null : (
          <p
            data-testid="cafe-disabled-notice"
            className="rounded-2xl border border-line bg-paper px-4 py-3 text-[13px] leading-snug text-ink-2"
          >
            The café module is not enabled for this club, so new counter
            orders cannot be started. Existing orders below can still be
            billed and collected.
          </p>
        )}

        <CafeOpenOrders orders={openOrders} />

        {canStartNewOrder && menu && locations ? (
          <CafeOrderScreen
            categories={menu.categories}
            items={menu.items}
            locations={locations}
            terminology={terminology}
            taxRegistered={menu.taxRegistered}
          />
        ) : null}
      </div>
    </StaffPage>
  );
}
