"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createInvoiceAction,
  listMemberInvoicesAction,
} from "@/lib/actions/invoices";
import { listMemberSubscriptionsAction } from "@/lib/actions/subscriptions";
import type { InvoiceRow } from "@/lib/services/invoices";
import type { SubscriptionRow } from "@/lib/services/subscriptions";
import { formatINR } from "@/lib/money/format";
import { formatDateIST, todayInZone } from "@/lib/time/tz";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import { SUBSCRIPTIONS_CHANGED_EVENT } from "@/components/member-subscription-panel";

// C-32 — a member's invoices: raise one from an active subscription
// (the counter flow), then record payments and print receipts in the
// expanded row. Reception reads + records; issue/void is gated by the
// action layer.

export function MemberInvoicesPanel({
  memberId,
  canWrite,
  canRecord,
  canRefund,
  timezone,
}: {
  memberId: string;
  canWrite: boolean;
  canRecord: boolean;
  canRefund: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, subs] = await Promise.all([
        listMemberInvoicesAction(memberId),
        listMemberSubscriptionsAction(memberId),
      ]);
      setInvoices(rows);
      const active = subs.filter((s) => s.status === "active");
      setSubscriptions(active);
      setSubscriptionId((current) => current || active[0]?.id || "");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The membership panel starts subscriptions in its own client state;
  // this panel's copy of the active list has to follow.
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(SUBSCRIPTIONS_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(SUBSCRIPTIONS_CHANGED_EVENT, onChanged);
  }, [load]);

  // The service raises today's invoice by default, so a live row for
  // this subscription and today's tenant-local date means the button
  // would only reproduce the duplicate the service now refuses.
  const today = todayInZone(timezone);
  const raisedToday =
    invoices?.some(
      (invoice) =>
        invoice.subscriptionId === subscriptionId &&
        invoice.status !== "void" &&
        invoice.dueOn === today,
    ) ?? false;

  if (failed) {
    return (
      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <p className="text-[12px] text-ink-3">Could not load invoices.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Invoices
      </p>

      {invoices === null ? (
        <p className="mt-2 text-[12px] text-ink-3">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-3">No invoices yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="rounded-ctl border border-line px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium text-ink">
                  {formatINR(invoice.totalPaise)}
                  <span className="ml-2 font-mono text-[12px] text-ink-3">
                    {invoice.invoiceNumber}
                  </span>
                </span>
                <span className="rounded-pill bg-deck px-2 py-0.5 text-[11px] font-medium text-ink-2">
                  {invoice.status}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {formatDateIST(invoice.issuedOn)} · {invoice.locationName}
                {invoice.activityName ? ` · ${invoice.activityName}` : ""}
                {invoice.outstandingPaise > 0
                  ? ` · ${formatINR(invoice.outstandingPaise)} outstanding`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() =>
                  setExpandedId(expandedId === invoice.id ? null : invoice.id)
                }
                className="mt-1.5 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
              >
                {expandedId === invoice.id ? "Hide" : "View"}
              </button>
              {expandedId === invoice.id ? (
                <InvoiceExpanded
                  invoiceId={invoice.id}
                  canWrite={canWrite}
                  canRecord={canRecord}
                  canRefund={canRefund}
                  onChanged={() => {
                    void load();
                    router.refresh();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        subscriptions.length === 0 ? (
          <p className="mt-3 text-[12px] text-ink-3">
            Start an active subscription to raise an invoice.
          </p>
        ) : (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[12px] font-medium text-ink-2">Raise an invoice</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-ink-3">
                  Subscription
                </span>
                <select
                  value={subscriptionId}
                  onChange={(e) => setSubscriptionId(e.target.value)}
                  className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none"
                >
                  {subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.planName} · {formatINR(s.amountPaise)} · ends {s.endsOn}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={busy || !subscriptionId || raisedToday}
              onClick={() => {
                setBusy(true);
                setMessage(null);
                void (async () => {
                  const result = await createInvoiceAction({
                    subscriptionId,
                  });
                  setMessage(
                    result.ok
                      ? `Raised ${result.invoiceNumber}.`
                      : result.error,
                  );
                  if (result.ok) setExpandedId(result.id);
                  await load();
                  router.refresh();
                  setBusy(false);
                })();
              }}
              className="mt-2 rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Raise invoice"}
            </button>
            {raisedToday ? (
              <p className="mt-1.5 text-[12px] text-ink-3">
                An invoice for today already exists — collect against it above.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
