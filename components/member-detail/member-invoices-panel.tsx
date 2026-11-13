"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
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
// Money/recovery controls load only when the existing Open action is used.
const InvoiceExpanded = dynamic(
  () => import("@/components/member-detail/invoice-expanded").then((module) => module.InvoiceExpanded),
  { loading: () => <p role="status" className="text-[13px] text-ink-3">Loading invoice…</p> },
);
import { SUBSCRIPTIONS_CHANGED_EVENT } from "@/components/member-subscription-panel";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

// C-32 — a member's invoices: raise one from an active subscription
// (the counter flow), then record payments and print receipts in the
// expanded row. Reception reads, issues and records; voiding is
// management authority (settings.manage) and the expanded row asks
// non-managers to escalate instead.

const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partial: "Partially paid",
  paid: "Paid",
  void: "Void",
};

const INVOICE_STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  issued: "warn",
  partial: "warn",
  paid: "good",
  void: "neutral",
};

export function MemberInvoicesPanel({
  memberId,
  canWrite,
  canVoid = false,
  canRecord,
  canRefund,
  canReadPayments,
  timezone,
  showHeading = true,
}: {
  memberId: string;
  canWrite: boolean;
  canVoid?: boolean;
  canRecord: boolean;
  canRefund: boolean;
  canReadPayments: boolean;
  timezone: string;
  // Owner 360 passes its own section heading; reception and the payer
  // view keep the panel label.
  showHeading?: boolean;
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
      {showHeading ? (
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Invoices
        </p>
      ) : null}

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
                <span data-testid="member-invoice-status">
                  <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>
                    {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                  </StatusBadge>
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">
                Issued {formatDateIST(invoice.issuedOn)} · {invoice.locationName}
                {invoice.activityName ? ` · ${invoice.activityName}` : ""}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-ink-2 tabular-nums">
                <span data-testid="member-invoice-due">
                  Due {formatDateIST(invoice.dueOn)}
                </span>
                <span data-testid="member-invoice-balance">
                  Balance {formatINR(invoice.outstandingPaise)}
                </span>
              </p>
              <button
                type="button"
                onClick={() =>
                  setExpandedId(expandedId === invoice.id ? null : invoice.id)
                }
                className="mt-1.5 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
              >
                {expandedId === invoice.id ? "Hide" : "Open"}
              </button>
              {expandedId === invoice.id ? (
                <InvoiceExpanded
                  invoiceId={invoice.id}
                  canWrite={canWrite}
                  canVoid={canVoid}
                  canRecord={canRecord}
                  canRefund={canRefund}
                  canReadPayments={canReadPayments}
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
              <Field id="member-invoice-subscription" label="Subscription">
                {(field) => (
                <Select
                  {...field}
                  value={subscriptionId}
                  onChange={(e) => setSubscriptionId(e.target.value)}
                >
                  {subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.planName} · {formatINR(s.amountPaise)} · ends{" "}
                      {formatDateIST(s.endsOn)}
                    </option>
                  ))}
                </Select>
                )}
              </Field>
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={busy || !subscriptionId || raisedToday}
              onClick={() => {
                setBusy(true);
                setMessage(null);
                void (async () => {
                  try {
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
                  } catch {
                    try {
                      await load();
                    } catch {
                      // load() already switched the panel to its failed state
                    }
                    setMessage(
                      "The request did not complete. The list was refreshed — check whether the invoice was raised before trying again.",
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              data-testid="raise-invoice"
              className="mt-2"
            >
              {busy ? "Saving…" : "Raise invoice"}
            </Button>
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
