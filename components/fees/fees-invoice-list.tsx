"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { listHubInvoicesAction } from "@/lib/actions/fees-hub";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

// U-02 — the dues and invoice lists. Dues are collectible in place
// (the existing InvoiceExpanded carries the record-payment form);
// the full invoice list uses the same rows without inviting a
// payment on a settled document. One client island per list, no
// page-level JavaScript.
//
// Owner-UI review P1 (2026-10-13) — the reload used to drop the
// facility scope the server rendered with, so recording a payment
// silently widened the list to every facility. The scope is now
// part of the request and of the rendered state: rows are only
// shown when they belong to the current scope, and an older
// response cannot replace a newer one (request sequence).

type RowsState = { scope: string; rows: HubInvoiceRow[] };

// Invoice lifecycle → a readable word and a status tone. `issued` and
// `partial` mean money is still owed (the needs-attention tone),
// `paid` means settled, `draft` and `void` carry no urgency.
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

export function FeesInvoiceList({
  initial,
  filter,
  facility,
  canWrite,
  canVoid = false,
  canRecord,
  canRefund,
  canReadPayments,
}: {
  initial: HubInvoiceRow[];
  filter: "dues" | "all";
  // The validated facility scope the server rendered with. null/absent
  // means "every facility the caller may see".
  facility?: string | null;
  canWrite: boolean;
  canVoid?: boolean;
  canRecord: boolean;
  canRefund: boolean;
  canReadPayments: boolean;
}) {
  const router = useRouter();
  const scope = `${filter}|${facility ?? ""}`;
  const [data, setData] = useState<RowsState | null>(() => ({
    scope,
    rows: initial,
  }));
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const loadedScope = useRef(scope);

  const load = useCallback(async () => {
    const requestScope = `${filter}|${facility ?? ""}`;
    const seq = ++requestSeq.current;
    setLoadError(false);
    try {
      const next = await listHubInvoicesAction({
        status: filter,
        ...(facility ? { locationId: facility } : {}),
      });
      // A slower response for an earlier scope must not replace the
      // current one; the next load() (new scope or explicit reload)
      // bumps the sequence. The render also refuses rows whose scope
      // no longer matches the heading.
      if (seq !== requestSeq.current) return;
      setData({ scope: requestScope, rows: next });
    } catch {
      if (seq === requestSeq.current) setLoadError(true);
    }
  }, [filter, facility]);

  useEffect(() => {
    // The server already rendered this scope's rows. Only fetch when
    // the scope changed after mount, or on the explicit reload path.
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      void load();
    }
  }, [scope, load]);

  const rows = data && data.scope === scope ? data.rows : null;

  if (loadError) {
    return (
      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <p className="text-[13px] text-ink-3">
          Could not load this list — the figures above may be stale.
        </p>
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

  if (rows === null) {
    return <p className="mt-4 text-[13px] text-ink-3">Loading…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-[13px] text-ink-3">
        {filter === "dues"
          ? "Nothing outstanding — every issued invoice is settled."
          : "No invoices yet. Raise one from a member's page or the member's active plan."}
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-2">
      {rows.map((invoice) => {
        const overdue =
          invoice.outstandingPaise > 0 && invoice.dueOn < new Date().toISOString().slice(0, 10);
        return (
          <li
            key={invoice.id}
            className="rounded-card border border-line bg-paper p-3.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/owner/members/${invoice.memberId}`}
                className="text-[14px] font-medium text-ink"
              >
                {invoice.memberName}
              </Link>
              <span className="font-mono text-[12px] text-ink-3">
                {invoice.invoiceNumber}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-3">
              {formatINR(invoice.totalPaise)} · {invoice.locationName} · issued{" "}
              {formatDateIST(invoice.issuedOn)} · due {formatDateIST(invoice.dueOn)}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {/* Owner redesign (C2) — the invoice state is a readable
                  word in the shared status pill, not the raw database
                  value in a bare chip. The tone map lives here (not in
                  the shared primitive) so the token strings stay in
                  their one home. */}
              <span data-testid="invoice-status">
                <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>
                  {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                </StatusBadge>
              </span>
              {overdue ? <StatusBadge tone="late">Overdue</StatusBadge> : null}
              {invoice.outstandingPaise > 0 ? (
                <span className="text-[12px] text-ink-2 tabular-nums">
                  {formatINR(invoice.outstandingPaise)} outstanding
                </span>
              ) : (
                <span className="text-[12px] text-ink-3">Nothing outstanding</span>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setExpandedId(expandedId === invoice.id ? null : invoice.id)
                }
                className="ml-auto"
              >
                {expandedId === invoice.id ? "Hide" : "Open"}
              </Button>
            </div>
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
        );
      })}
    </ul>
  );
}
