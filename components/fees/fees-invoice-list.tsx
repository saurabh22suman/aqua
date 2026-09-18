"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { listHubInvoicesAction } from "@/lib/actions/fees-hub";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";

// U-02 — the dues and invoice lists. Dues are collectible in place
// (the existing InvoiceExpanded carries the record-payment form);
// the full invoice list uses the same rows without inviting a
// payment on a settled document. One client island per list, no
// page-level JavaScript.

export function FeesInvoiceList({
  initial,
  filter,
  canWrite,
  canRecord,
}: {
  initial: HubInvoiceRow[];
  filter: "dues" | "all";
  canWrite: boolean;
  canRecord: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<HubInvoiceRow[]>(initial);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await listHubInvoicesAction({ status: filter });
    setRows(next);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

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
              <span className="rounded-pill bg-deck px-2 py-0.5 text-[11px] font-medium text-ink-2">
                {invoice.status}
              </span>
              {overdue ? (
                <span className="rounded-pill bg-late-soft px-2 py-0.5 text-[11px] font-medium text-late">
                  Overdue
                </span>
              ) : null}
              {invoice.outstandingPaise > 0 ? (
                <span className="text-[12px] text-ink-2 tabular-nums">
                  {formatINR(invoice.outstandingPaise)} outstanding
                </span>
              ) : (
                <span className="text-[12px] text-good">Settled</span>
              )}
              <button
                type="button"
                onClick={() =>
                  setExpandedId(expandedId === invoice.id ? null : invoice.id)
                }
                className="ml-auto rounded-pill border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink"
              >
                {expandedId === invoice.id ? "Hide" : "Open"}
              </button>
            </div>
            {expandedId === invoice.id ? (
              <InvoiceExpanded
                invoiceId={invoice.id}
                canWrite={canWrite}
                canRecord={canRecord}
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
