"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CafeBillPanel } from "@/components/cafe-bill-panel";
import { CafeErrorNote } from "@/components/cafe-error-note";
import { CafeReceipt } from "@/components/cafe-payment-panel";
import { requestCafeBillAction } from "@/lib/actions/orders";
import { formatINR } from "@/lib/money/format";
import type { CafeBill, OpenCafeOrderRow } from "@/lib/services/cafe-billing";
import type { PaymentMethod } from "@/components/cafe-order-shared";

// K-08 — reception café billing, the "pick an open order" half.
// Billing happens only at reception, like membership billing: the
// receptionist selects a placed/served (or billed-unpaid) order, the
// system issues the bill through the K-03 bridge and shows the
// itemized amount due, then the existing payment panel collects it.
//
// A walk-in order is listed with the server's reason and its bill
// action disabled — there is deliberately no anonymous path.

const STATUS_LABEL: Record<string, string> = {
  placed: "Placed",
  served: "Served",
  billed: "Bill raised",
};

export function CafeOpenOrders({ orders }: { orders: OpenCafeOrderRow[] }) {
  const router = useRouter();
  const [bill, setBill] = useState<CafeBill | null>(null);
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function requestBill(order: OpenCafeOrderRow) {
    setBusyId(order.orderId);
    setError(null);
    try {
      const result = await requestCafeBillAction({ orderId: order.orderId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBill(result.bill);
    } catch {
      setError("The bill could not be raised. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  function backToList() {
    setBill(null);
    setPaid(false);
    setError(null);
    router.refresh();
  }

  if (bill && paid) {
    return <CafeReceipt bill={bill} method={paidMethod} onReset={backToList} />;
  }

  if (bill) {
    return (
      <div className="space-y-4">
        {error ? <CafeErrorNote message={error} /> : null}
        <CafeBillPanel
          bill={bill}
          onPaid={(method) => {
            setPaidMethod(method);
            setPaid(true);
          }}
        />
        <Button variant="ghost" size="md" className="w-full" onClick={backToList}>
          Back to open orders
        </Button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No open café orders"
        body="Orders placed at the counter appear here until their bill is settled."
      />
    );
  }

  return (
    <section
      className="rounded-card border border-line bg-paper p-4"
      data-testid="cafe-open-orders"
    >
      <h2 className="font-display text-[15px] font-semibold text-ink">
        Open orders
      </h2>

      {error ? <CafeErrorNote message={error} /> : null}

      <ul className="mt-2 divide-y divide-line">
        {orders.map((order) => {
          const label = order.memberName ?? "Walk-in";
          return (
            <li
              key={order.orderId}
              className="py-3 space-y-2"
              data-testid={`cafe-open-order-${order.orderId}`}
              data-amount-due={order.amountDuePaise}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">{label}</p>
                  <p className="text-[12px] text-ink-3">
                    {STATUS_LABEL[order.status] ?? order.status}
                    {order.invoiceNumber ? ` · ${order.invoiceNumber}` : ""}
                  </p>
                </div>
                <span className="text-[14px] font-medium text-ink">
                  {formatINR(order.amountDuePaise)}
                </span>
              </div>

              {order.billable ? (
                <Button
                  variant="secondary"
                  size="md"
                  className="w-full"
                  onClick={() => requestBill(order)}
                  disabled={busyId === order.orderId}
                  aria-label={`Request bill for ${label}`}
                >
                  {busyId === order.orderId ? "Working…" : "Request bill"}
                </Button>
              ) : (
                <p
                  className="rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[12px] text-ink"
                  data-testid={`cafe-open-walk-in-${order.orderId}`}
                >
                  A walk-in order needs a member before it can be billed.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
