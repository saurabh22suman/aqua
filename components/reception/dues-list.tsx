"use client";

import { useState } from "react";
import Link from "next/link";
import Phone from "lucide-react/dist/esm/icons/phone.mjs";
import { formatINR } from "@/lib/money/format";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import type { DeskDueRow } from "@/lib/services/fees-hub";
import { COLLECTION_HOLD_COPY } from "@/lib/collection-hold";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { STAFF_CARD } from "@/components/staff-ui/staff-page";

const FILTERS = [
  { id: "all", label: "All open" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Not overdue" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

export function ReceptionDuesList({ dues, canCollect, limit }: { dues: DeskDueRow[]; canCollect: boolean; limit: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const term = query.trim().toLocaleLowerCase();
  const phoneTerm = term.replace(/[^0-9]/g, "");
  const rows = dues.filter((row) =>
    (filter === "all" || row.overdue === (filter === "overdue"))
    && (term === "" || [row.payerName, row.invoiceNumber, row.memberCode].some((value) => value?.toLocaleLowerCase().includes(term))
      || (phoneTerm.length >= 3 && /^[+\d\s()-]+$/.test(term) && row.phone?.replace(/[^0-9]/g, "").includes(phoneTerm))),
  );

  if (!dues.length) return <p className={`mt-5 p-4 text-sm ${STAFF_CARD}`}>No open invoices in your current scope.</p>;

  return (
    <section className="mt-4 space-y-3" aria-label="Open invoices">
      <div className={`space-y-2 p-4 ${STAFF_CARD}`}>
        <label className="block text-sm font-semibold" htmlFor="desk-dues-query">Find a due invoice</label>
        <p id="desk-dues-search-hint" className="text-xs text-ink-2">Name, invoice number, code or phone</p>
        <Input id="desk-dues-query" type="search" aria-describedby="desk-dues-search-hint" value={query}
          onChange={(event) => setQuery(event.target.value)} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Due date">
          {FILTERS.map((item) => (
            <Button key={item.id} size="sm" variant={filter === item.id ? "primary" : "secondary"}
              aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</Button>
          ))}
        </div>
        <p role="status" className="text-sm text-ink-2">{rows.length} {rows.length === 1 ? "invoice" : "invoices"} shown.</p>
        {dues.length >= limit ? <p className="text-xs text-ink-2">Search covers the first {limit} open invoices, ordered by due date.</p> : null}
      </div>
      {rows.length ? (
        <ul className={`divide-y divide-line ${STAFF_CARD}`}>
          {rows.map((due) => {
            const holdCopy = due.collectionHold
              ? COLLECTION_HOLD_COPY[due.collectionHold]
              : null;
            return (
              <li key={due.id} data-testid={`desk-due-${due.id}`} className="space-y-2 p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <div className="min-w-0 break-words">
                    <p className="font-semibold">{due.payerName}</p>
                    <p className="text-xs text-ink-2">{due.memberCode ?? "Walk-in"}{due.phone ? ` · ${formatPhoneIN(due.phone)}` : ""}</p>
                  </div>
                  <p className="font-semibold tabular-nums">{formatINR(due.outstandingPaise)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                  <StatusBadge tone={holdCopy ? "warn" : due.overdue ? "late" : "neutral"}>{holdCopy ? holdCopy.label : due.overdue ? "Overdue" : "Open"}</StatusBadge>
                  <span className="break-words">{due.invoiceNumber} · Due {formatDateIST(due.dueOn)}</span>
                </div>
                {holdCopy ? <p className="text-xs text-ink-2">{holdCopy.description}</p> : null}
                {holdCopy ? null : (
                  <div className="flex flex-wrap gap-2">
                    {due.phone ? <a href={`tel:${due.phone}`} aria-label={`Call ${due.payerName}`} className={buttonClasses({ size: "sm" })}><Phone size={14} aria-hidden="true" /> Call</a> : null}
                    {canCollect ? <Link href={`/reception/collect-payment?invoice=${encodeURIComponent(due.id)}`}
                      aria-label={`Collect payment for ${due.payerName}, invoice ${due.invoiceNumber}`} className={buttonClasses({ size: "sm" })}>Collect</Link> : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={`space-y-2 p-4 ${STAFF_CARD}`}>
          <p className="text-sm">No invoices match this search and filter.</p>
          <Button size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button>
        </div>
      )}
    </section>
  );
}
