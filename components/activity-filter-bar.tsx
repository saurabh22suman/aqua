"use client";

import { Button } from "@/components/ui/Button";
import { useMemo, useState, useTransition } from "react";
import { Filter, Loader2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { DateField } from "@/components/ui/DateField";
import {
  DATE_RANGE_OPTIONS,
  activityDateRangeBounds,
  buildActivityDateQuery,
  normalizeActivityDate,
} from "@/components/ops/ops-activity-date";

// Phase 3.9 — platform activity filter bar. Server component
// renders the form; the form submits its own query (changing
// the URL via shallow routing would not re-run the server
// data fetch unless React Server Components re-render). The
// pragmatic UI for now is "Apply" — server push with full nav.
//
// The date bounds use the product's shared DATE control
// (components/ui/DateField.tsx): the native date input ignored the
// product's day-first format and rendered US mm/dd/yyyy segments on
// this locale, and it needed ~165px to show a full value. The date is
// CHOSEN from the product's calendar, and the emitted value is the
// canonical `yyyy-mm-dd` the query carried before.
//
// Human revision (31 October 2026): this filter shows DATES only — no
// hour, no minute, no AM/PM, no seconds — and offers the same date
// ranges as the Ops activity filter. An inverted or unreadable range
// is REFUSED, never quietly applied.

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
  const inbound = useMemo(() => {
    const sinceRaw = initial.since ?? "";
    const untilRaw = initial.until ?? "";
    const since = sinceRaw ? normalizeActivityDate(sinceRaw) : null;
    const until = untilRaw ? normalizeActivityDate(untilRaw) : null;
    return {
      range: sinceRaw || untilRaw ? "custom" : "",
      sinceDate: since ?? "",
      untilDate: until ?? "",
      refused: Boolean((sinceRaw && !since) || (untilRaw && !until)),
    };
  }, [initial.since, initial.until]);

  const [action, setAction] = useState(initial.action ?? "");
  const [tenantId, setTenantId] = useState(initial.tenantId ?? "");
  const [range, setRange] = useState(inbound.range);
  const [since, setSince] = useState(inbound.sinceDate);
  const [until, setUntil] = useState(inbound.untilDate);
  const [refused, setRefused] = useState(inbound.refused);
  // Every bound reports its own validity, so an incomplete or
  // impossible date can never be applied behind the operator's back.
  const [sinceValid, setSinceValid] = useState(true);
  const [untilValid, setUntilValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function edit(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setRefused(false);
      if (range !== "custom") setRange("custom");
    };
  }

  function chooseRange(next: string) {
    setRange(next);
    setError(null);
    setRefused(false);
    if (next === "") {
      setSince("");
      setUntil("");
      return;
    }
    const bounds = activityDateRangeBounds(next);
    if (bounds) {
      setSince(bounds.since);
      setUntil(bounds.until);
    }
  }

  function apply() {
    // A visible but unfinished date is REFUSED, never submitted.
    if (refused) {
      setError("That date filter is not a real date.");
      return;
    }
    if (!sinceValid) {
      setError("Enter a real since date.");
      return;
    }
    if (!untilValid) {
      setError("Enter a real until date.");
      return;
    }
    const result = buildActivityDateQuery({
      action,
      tenantId,
      range,
      sinceDate: since,
      untilDate: until,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    startTransition(() => {
      window.location.search = result.query;
    });
  }

  function reset() {
    setAction("");
    setTenantId("");
    chooseRange("");
  }

  return (
    <div className="bg-paper border border-line rounded-card p-4 grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block min-w-0">
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
        <label className="block min-w-0">
          <span className="block text-[12px] text-ink-3 mb-1">Tenant id</span>
          <Input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="optional uuid"
            className="w-full border font-mono"
          />
        </label>
        <label className="block min-w-0">
          <span className="block text-[12px] text-ink-3 mb-1">Range</span>
          <Select
            value={range}
            onChange={(e) => chooseRange(e.target.value)}
            className="w-full border"
          >
            {DATE_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="activity-filter-since" className="mb-1 block text-[12px] text-ink-3">
            Since date
          </label>
          <DateField
            id="activity-filter-since"
            value={since}
            onChange={edit(setSince)}
            onValidityChange={setSinceValid}
            formatHint="sr-only"
            calendarLabel="Choose start date"
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="activity-filter-until" className="mb-1 block text-[12px] text-ink-3">
            Until date
          </label>
          <DateField
            id="activity-filter-until"
            value={until}
            onChange={edit(setUntil)}
            onValidityChange={setUntilValid}
            formatHint="sr-only"
            calendarLabel="Choose end date"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
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
      {error ? (
        <p
          role="alert"
          data-testid="activity-filter-error"
          className="rounded-ctl border border-[color-mix(in_srgb,var(--color-late)_30%,transparent)] bg-[var(--color-late-soft)] px-3 py-2 text-[12.5px] text-[var(--color-late)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
