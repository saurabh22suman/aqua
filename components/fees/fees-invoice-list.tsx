"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listHubInvoicesAction } from "@/lib/actions/fees-hub";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
import type { InvoiceSettledSummary } from "@/components/member-detail/invoice-expanded";
import { Button } from "@/components/ui/Button";
import { FeesInvoiceLedger, FeesSettledResult } from "@/components/fees/fees-invoice-ledger";

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
//
// WR-1 / Option A — a walk-in bill has no member, so the row shows
// the PAYER's name and links to no member page: there is none. The
// row still opens the document (InvoiceExpanded reads the invoice
// itself), so a walk-in bill is as collectable and as visible as a
// member's.

type RowsState = { scope: string; rows: HubInvoiceRow[] };
type RememberedDues = { token:string; namespace:string; scope:string; search:string; status:"" | "issued" | "partial" };
// Search text stays in memory, not URLs or browser storage. The history
// entry holds only an opaque token and cannot restore another account's scope.
let rememberedDues: RememberedDues | null = null;

export function FeesInvoiceList({
  initial,
  filter,
  facility,
  canWrite,
  canVoid = false,
  canRecord,
  canRefund,
  canReadPayments,
  caption = "Invoice ledger",
  initialInvoiceId,
  navigationNamespace,
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
  // Accessible table caption; the surrounding page owns the visible heading.
  caption?: string;
  initialInvoiceId?: string;
  navigationNamespace?: string;
}) {
  const router = useRouter();
  const scope = `${filter}|${facility ?? ""}`;
  const [data, setData] = useState<RowsState | null>(() => ({
    scope,
    rows: initial,
  }));
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<"" | "issued" | "partial">("");
  const [expandedId, setExpandedId] = useState<string | null>(() => initial.some((invoice) => invoice.id === initialInvoiceId) ? initialInvoiceId! : null);
  const lastTarget = useRef(initialInvoiceId);
  useEffect(() => {
    if (lastTarget.current === initialInvoiceId) return;
    lastTarget.current = initialInvoiceId;
    setExpandedId(initialInvoiceId && initial.some((invoice) => invoice.id === initialInvoiceId) ? initialInvoiceId : null);
  }, [initialInvoiceId, initial]);
  // MF-01 — the last full settlement in THIS Dues scope. It is a
  // presentation snapshot from rows the operator already saw; no
  // storage, extra read or financial change is introduced.
  const [settled, setSettled] = useState<InvoiceSettledSummary | null>(null);
  const settledHeadingRef = useRef<HTMLParagraphElement | null>(null);
  const requestSeq = useRef(0);
  const loadedScope = useRef(scope);
  const restoredToken = useRef<string | null>(null);

  const load = useCallback(async (nextSearch = appliedSearch, nextStatus = invoiceStatus) => {
    const requestScope = `${filter}|${facility ?? ""}`;
    const seq = ++requestSeq.current;
    setLoadError(false);
    try {
      const next = await listHubInvoicesAction({
        status: filter,
        ...(facility ? { locationId: facility } : {}),
        ...(nextSearch ? { search: nextSearch } : {}),
        ...(nextStatus ? { invoiceStatus: nextStatus } : {}),
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
  }, [filter, facility, appliedSearch, invoiceStatus]);

  useEffect(() => {
    if (filter !== "dues" || !navigationNamespace || !rememberedDues) return;
    const token = window.history.state?.aquaDuesSearchToken;
    if (typeof token !== "string" || token === restoredToken.current || token !== rememberedDues.token || rememberedDues.namespace !== navigationNamespace || rememberedDues.scope !== scope) return;
    restoredToken.current = token;
    setSearch(rememberedDues.search);
    setAppliedSearch(rememberedDues.search);
    setInvoiceStatus(rememberedDues.status);
    void load(rememberedDues.search, rememberedDues.status);
  }, [filter, navigationNamespace, scope, load]);

  function remember(searchValue:string, statusValue:"" | "issued" | "partial") {
    if (!navigationNamespace) return;
    const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    rememberedDues = {token,namespace:navigationNamespace,scope,search:searchValue,status:statusValue};
    window.history.replaceState({...window.history.state,aquaDuesSearchToken:token}, "");
    restoredToken.current = token;
  }

  useEffect(() => {
    // The server already rendered this scope's rows. Only fetch when
    // the scope changed after mount, or on the explicit reload path.
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      void load();
    }
  }, [scope, load]);

  const rows = data && data.scope === scope ? data.rows : null;

  // A completion belongs to the Dues/facility scope that produced it.
  useEffect(() => {
    setSettled(null);
  }, [scope]);

  // O4 — the focused control inside the settled row disappears with it.
  // Move focus to the retained result so keyboard/screen-reader operators
  // are not dropped back to <body> exactly when the outcome appears.
  useEffect(() => {
    if (settled) settledHeadingRef.current?.focus();
  }, [settled]);

  const settledResult = filter === "dues" ? <FeesSettledResult settled={settled} facility={facility}
    settledHeadingRef={settledHeadingRef} onDismiss={() => setSettled(null)} /> : null;

  const lookup = filter === "dues" ? (
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      const value = search.trim();
      setAppliedSearch(value);
      remember(value, invoiceStatus);
      void load(value, invoiceStatus);
    }}>
      <label className="min-w-0 flex-1 text-[13px] text-ink-2">
        Search member, phone or invoice
        <input type="search" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} className="mt-1 min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-ink" />
      </label>
      <label className="text-[13px] text-ink-2">
        Status
        <select value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value as "" | "issued" | "partial")} className="mt-1 block min-h-11 rounded-ctl border border-line bg-paper px-3 text-ink">
          <option value="">All due</option><option value="issued">Issued</option><option value="partial">Partially paid</option>
        </select>
      </label>
      <Button type="submit" variant="secondary">Search</Button>
      {(search || appliedSearch || invoiceStatus) ? <Button type="button" variant="secondary" onClick={() => { setSearch(""); setAppliedSearch(""); setInvoiceStatus(""); rememberedDues = null; void load("", ""); }}>Clear</Button> : null}
    </form>
  ) : null;

  if (loadError) {
    return (
      <>
        {settledResult}
        {lookup}
        <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
          <p className="text-[13px] text-ink-3">
            Could not load this list — the figures above may be stale.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  if (rows === null) {
    return (
      <>
        {settledResult}
        {lookup}
        <p className="mt-4 text-[13px] text-ink-3">Loading…</p>
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        {settledResult}
        {lookup}
        <p className="mt-4 text-[13px] text-ink-3">
          {appliedSearch || invoiceStatus ? "No invoices match these filters." : filter === "dues"
            ? "Nothing outstanding — every issued invoice is settled."
            : "No invoices yet. Raise one from a member's page or the member's active plan."}
        </p>
      </>
    );
  }

  function toggle(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  return (
    <>
      {settledResult}
      {lookup}
      <FeesInvoiceLedger rows={rows} facility={facility} filter={filter} caption={caption}
        expandedId={expandedId} canWrite={canWrite} canVoid={canVoid} canRecord={canRecord}
        canRefund={canRefund} canReadPayments={canReadPayments} onToggle={toggle}
        onSettled={setSettled} onChanged={() => { void load(); router.refresh(); }} />
    </>
  );
}
