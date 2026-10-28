"use client";

import { Button } from "@/components/ui/Button";
import { useState, useTransition } from "react";
import { Filter, Loader2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

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
        <Select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="w-full border"
        >
          <option value="">Any</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </label>
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Tenant id</span>
        <Input
          type="text"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="optional uuid"
          className="w-full border font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Since</span>
        <Input
          type="date"
          lang="en-IN"
          placeholder="dd/mm/yyyy"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="w-full border"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Until</span>
        <Input
          type="date"
          lang="en-IN"
          placeholder="dd/mm/yyyy"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="w-full border"
        />
      </label>
      <div className="md:col-span-4 flex gap-2 justify-end">
        <Button
          variant="secondary"
          size="md"
          className="bg-deck text-ink-2"
          type="button"
          onClick={reset}
          disabled={pending}>
        Reset
      </Button>
        <Button
          variant="primary"
          size="md"
          className="flex items-center gap-1.5"
          type="button"
          onClick={apply}
          disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
          Apply
      </Button>
      </div>
    </div>
  );
}
