"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CafeCart } from "@/components/cafe-cart";
import { CafeErrorNote } from "@/components/cafe-error-note";
import {
  CafeLocationSwitcher,
  CafeMenuGrid,
} from "@/components/cafe-menu-grid";
import { CafeMemberPicker } from "@/components/cafe-member-picker";
import { CafeReceipt } from "@/components/cafe-payment-panel";
import { CafeBillPanel } from "@/components/cafe-bill-panel";
import { createOrderAction, requestCafeBillAction } from "@/lib/actions/orders";
import {
  WALK_IN_NOTE,
  type CartLine,
  type PaymentMethod,
  type PlacedOrder,
} from "@/components/cafe-order-shared";
import type {
  LocationOption,
  MemberListRow,
} from "@/lib/services/people";
import type { MenuCategoryRow, MenuItemRow } from "@/lib/services/menu";
import type { CafeBill } from "@/lib/services/cafe-billing";
import type { TerminologyState } from "@/lib/terminology/keys";

// K-07/K-08 — reception café counter, one screen end to end: menu grid
// → cart → optional member → order → request bill → amount due →
// collect payment → receipt. The back end is frozen; every rule below
// is the server's, surfaced rather than re-implemented:
//   * walk-in orders record but cannot bill (the K-03 bridge refuses
//     an order with no member_id) — the bill action stays disabled
//     and states the exact limitation;
//   * requesting the bill issues the invoice (if needed) and returns
//     the itemized amount due; the payment panel then collects it in
//     full (K-04) and any refusal is shown.

export function CafeOrderScreen({
  categories,
  items,
  locations,
  terminology,
}: {
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
  locations: LocationOption[];
  terminology: TerminologyState;
}) {
  const menuLocations = useMemo(() => {
    const ids: string[] = [];
    for (const item of items) {
      if (!ids.includes(item.locationId)) ids.push(item.locationId);
    }
    return ids.map((id) => ({
      id,
      name: locations.find((location) => location.id === id)?.name ?? "Café",
    }));
  }, [items, locations]);

  const [locationId, setLocationId] = useState(menuLocations[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [member, setMember] = useState<MemberListRow | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [bill, setBill] = useState<CafeBill | null>(null);
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const lines: CartLine[] = useMemo(
    () =>
      Object.entries(qty)
        .map(([itemId, count]) => {
          const item = itemById.get(itemId);
          return item ? { item, qty: count } : null;
        })
        .filter(
          (line): line is { item: MenuItemRow; qty: number } => line !== null,
        ),
    [qty, itemById],
  );

  const billable = placed ? placed.memberId !== null : member !== null;
  const locked = placed !== null;

  function changeQty(itemId: string, delta: number) {
    setQty((prev) => {
      const next = Math.max(0, (prev[itemId] ?? 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[itemId];
      else copy[itemId] = next;
      return copy;
    });
  }

  function reset() {
    setQty({});
    setMember(null);
    setPlaced(null);
    setBill(null);
    setPaid(false);
    setPaidMethod("cash");
    setError(null);
  }

  async function placeOrder() {
    if (lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createOrderAction({
        locationId,
        memberId: member?.memberId ?? null,
        lines: lines.map((line) => ({ itemId: line.item.id, qty: line.qty })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPlaced({
        orderId: result.orderId,
        totalPaise: result.totalPaise,
        memberId: member?.memberId ?? null,
      });
    } catch {
      setError("The order could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestBill() {
    if (!billable || lines.length === 0) {
      setError(WALK_IN_NOTE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let current = placed;
      if (!current) {
        const created = await createOrderAction({
          locationId,
          memberId: member?.memberId ?? null,
          lines: lines.map((line) => ({ itemId: line.item.id, qty: line.qty })),
        });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        current = {
          orderId: created.orderId,
          totalPaise: created.totalPaise,
          memberId: member?.memberId ?? null,
        };
        setPlaced(current);
      }
      const billed = await requestCafeBillAction({ orderId: current.orderId });
      if (!billed.ok) {
        setError(billed.error);
        return;
      }
      setBill(billed.bill);
    } catch {
      setError("The bill could not be raised. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (bill && paid) {
    return <CafeReceipt bill={bill} method={paidMethod} onReset={reset} />;
  }

  if (bill) {
    return (
      <div className="space-y-5">
        {error ? <CafeErrorNote message={error} /> : null}
        <CafeBillPanel
          bill={bill}
          onPaid={(method) => {
            setPaidMethod(method);
            setPaid(true);
          }}
        />
      </div>
    );
  }

  const activeCategories = categories.filter(
    (category) => category.locationId === locationId && category.isActive,
  );
  const visibleItems = items.filter(
    (item) => item.locationId === locationId && item.isActive,
  );

  return (
    <div className="space-y-6">
      {error ? <CafeErrorNote message={error} /> : null}

      <CafeLocationSwitcher
        locations={menuLocations}
        locationId={locationId}
        onSelect={setLocationId}
      />

      {visibleItems.length === 0 ? (
        <EmptyState
          title="No menu items yet"
          body="The owner sets up the café menu in Settings → Café menu."
          action={{ label: "Back to Today", href: "/reception" }}
        />
      ) : (
        <>
          <CafeMenuGrid
            categories={activeCategories}
            items={visibleItems}
            locked={locked}
            onAdd={(itemId) => changeQty(itemId, 1)}
          />

          <CafeCart lines={lines} placed={placed} onQty={changeQty} />

          {!locked ? (
            <CafeMemberPicker
              member={member}
              terminology={terminology}
              onSelect={setMember}
              disabled={busy}
            />
          ) : null}

          {!billable ? (
            <p
              className="rounded-card border border-line bg-warn-soft px-4 py-3 text-[13px] text-ink"
              data-testid="cafe-walk-in-note"
            >
              {WALK_IN_NOTE}
            </p>
          ) : null}

          <div className="space-y-2">
            {!locked ? (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={placeOrder}
                disabled={busy || lines.length === 0}
              >
                Place order
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={requestBill}
              disabled={busy || lines.length === 0 || !billable}
            >
              {busy ? "Working…" : "Request bill"}
            </Button>
            {locked ? (
              <Button
                variant="ghost"
                size="md"
                className="w-full"
                onClick={reset}
              >
                Start a new order
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
