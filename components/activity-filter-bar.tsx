"use client";

import { useState, useTransition } from "react";
import { Filter, Loader2 } from "lucide-react";

// Phase 3.9 — platform activity filter bar. Server component
// renders the form; the form submits its own query (changing
// the URL via shallow routing would not re-run the server
// data fetch unless React Server Components re-render). The
// pragmatic UI for now is "Apply" — server push with full nav.

type Initial = {
  action?: string;
  tenantId?: string;
  since?: string;
  until?: string;
};

export function ActivityFilterBar({
  actions,
  initial,
}: {
  actions: string[];
  initial: Initial;
}) {
  const [action, setAction] = useState(initial.action ?? "");
  const [tenantId, setTenantId] = useState(initial.tenantId ?? "");
  const [since, setSince] = useState(initial.since ?? "");
  const [until, setUntil] = useState(initial.until ?? "");
  const [pending, startTransition] = useTransition();

  function apply() {
    const params = new URLSearchParams();
    if (action.trim()) params.set("action", action.trim());
    if (tenantId.trim()) params.set("tenantId", tenantId.trim());
    if (since.trim()) params.set("since", since.trim());
    if (until.trim()) params.set("until", until.trim());
    startTransition(() => {
      window.location.search = params.toString();
    });
  }

  function reset() {
    setAction("");
    setTenantId("");
    setSince("");
    setUntil("");
    startTransition(() => {
      window.location.search = "";
    });
  }

  return (
    <div className="bg-paper border border-line rounded-card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Action</span>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px]"
        >
          <option value="">Any</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Tenant id</span>
        <input
          type="text"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="optional uuid"
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px] font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Since</span>
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px]"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Until</span>
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px]"
        />
      </label>
      <div className="md:col-span-4 flex gap-2 justify-end">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="rounded-pill px-4 py-3 min-h-[44px] text-[13px] font-medium bg-deck text-ink-2 disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className="rounded-pill px-4 py-3 min-h-[44px] text-[13px] font-semibold text-paper bg-[var(--accent)] disabled:opacity-70 flex items-center gap-1.5"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
          Apply
        </button>
      </div>
    </div>
  );
}
