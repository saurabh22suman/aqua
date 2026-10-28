"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  RANGE_HOURS,
  RANGE_OPTIONS,
  activityRangeBounds,
  buildActivityQuery,
  formatIstParts,
} from "./ops-activity-time";

// Ops redesign (28 October 2026) — the activity filter.
//
// The old filter asked for a tenant UUID in a free-text box. The
// operator investigating a problem knows the club's NAME, not its id —
// so the filter could not be used at the moment it was needed. The
// tenant is now a PICKER over the real tenant list, labelled by name.
//
// THE DATE BOUNDS (a pre-freeze review found real defects here):
//
//   - The bounds are EXPLICIT date + time fields, labelled IST. A
//     single native date field cannot hold an instant, and a
//     relative range has to serialize one — so the operator could not
//     see, and could not re-enter, what the query actually carried.
//
//   - The timestamps are offset-aware and in IST (+05:30). The backend
//     filter is unchanged: it accepts an ISO timestamp with an offset
//     and compares it against `created_at`. No date library is added.
//
//   - A URL that carries bounds shows "Custom", never "Any time" — so
//     the operator can SEE that a bound is active.
//
//   - Choosing "Any time" clears the bounds.
//
//   - A relative range shows its TRUTHFUL visible bounds: the same
//     instants it puts in the query, rendered in IST.
//
//   - The start is never after the end.
//
// The filter submits its own query (changing the URL via shallow
// routing would not re-run the server data fetch unless React Server
// Components re-render).

export type ActivityTenant = {
  id: string;
  name: string;
  slug: string;
};

// The pure time/query model lives in components/ops/ops-activity-time.ts
// (it is asserted on its own); it is re-exported here so the island's
// public surface does not change.
export {
  RANGE_HOURS,
  RANGE_OPTIONS,
  activityRangeBounds,
  buildActivityQuery,
  buildIstTimestamp,
  formatIstParts,
  type ActivityFilterState,
  type ActivityQueryResult,
} from "./ops-activity-time";

export function OpsActivityFilter({
  actions,
  tenants,
  initial,
}: {
  actions: string[];
  tenants: readonly ActivityTenant[];
  initial: {
    action?: string;
    tenantId?: string;
    since?: string;
    until?: string;
  };
}) {
  // An inbound URL that carries bounds is a CUSTOM filter — it is
  // never presented as "Any time", which would hide an active bound.
  const inbound = useMemo(() => {
    const since = initial.since ? formatIstParts(initial.since) : null;
    const until = initial.until ? formatIstParts(initial.until) : null;
    return {
      range: since || until ? "custom" : "",
      sinceDate: since?.date ?? "",
      sinceTime: since?.time ?? "",
      untilDate: until?.date ?? "",
      untilTime: until?.time ?? "",
    };
  }, [initial.since, initial.until]);

  const [action, setAction] = useState(initial.action ?? "");
  const [tenantId, setTenantId] = useState(initial.tenantId ?? "");
  const [range, setRange] = useState(inbound.range);
  const [sinceDate, setSinceDate] = useState(inbound.sinceDate);
  const [sinceTime, setSinceTime] = useState(inbound.sinceTime);
  const [untilDate, setUntilDate] = useState(inbound.untilDate);
  const [untilTime, setUntilTime] = useState(inbound.untilTime);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function chooseRange(next: string) {
    setRange(next);
    setError(null);
    if (next === "") {
      // Any time clears the bounds.
      setSinceDate("");
      setSinceTime("");
      setUntilDate("");
      setUntilTime("");
      return;
    }
    if (RANGE_HOURS[next]) {
      // A relative range shows its truthful bounds.
      const bounds = activityRangeBounds(next)!;
      const since = formatIstParts(bounds.since);
      const until = formatIstParts(bounds.until);
      setSinceDate(since?.date ?? "");
      setSinceTime(since?.time ?? "");
      setUntilDate(until?.date ?? "");
      setUntilTime(until?.time ?? "");
    }
  }

  function apply() {
    const result = buildActivityQuery({
      action,
      tenantId,
      range,
      sinceDate,
      sinceTime,
      untilDate,
      untilTime,
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
    <div className="rounded-card border border-line bg-paper p-4">
      {/* The SELECTORS on their own row: action, tenant and range are
          short choices and read better side by side than squeezed
          into a column beside a date. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Action</span>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Any action</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Tenant</span>
          <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">Any tenant</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.slug})
              </option>
            ))}
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Range</span>
          <Select value={range} onChange={(e) => chooseRange(e.target.value)}>
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {/* The BOUNDS on their own row, each with room for its pair.
          A native date control needs about 165px to show its full
          value — the reviewer measured the squeezed layout at 105px
          (1280), 73px (1024) and 147px on a phone, with the year cut
          off. Each group therefore gets a half-width row of its own
          above the desktop width, and the full width below it. */}
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
      <fieldset className="min-w-0">
        <legend className="mb-1 block text-[12px] font-medium text-ink-2">
          Start (IST)
        </legend>
        {/* Side by side when there is room for both to show their
            full value, stacked on a narrow phone. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="sr-only">Since date (IST)</span>
            <Input
              type="date"
              lang="en-IN"
              aria-label="Since date (IST)"
              value={sinceDate}
              onChange={(e) => {
                setSinceDate(e.target.value);
                if (range !== "custom") setRange("custom");
              }}
            />
          </label>
          <label className="block min-w-0">
            <span className="sr-only">Since time (IST)</span>
            <Input
              type="time"
              step={1}
              aria-label="Since time (IST)"
              value={sinceTime}
              onChange={(e) => {
                setSinceTime(e.target.value);
                if (range !== "custom") setRange("custom");
              }}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-1 block text-[12px] font-medium text-ink-2">
          End (IST)
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="sr-only">Until date (IST)</span>
            <Input
              type="date"
              lang="en-IN"
              aria-label="Until date (IST)"
              value={untilDate}
              onChange={(e) => {
                setUntilDate(e.target.value);
                if (range !== "custom") setRange("custom");
              }}
            />
          </label>
          <label className="block min-w-0">
            <span className="sr-only">Until time (IST)</span>
            <Input
              type="time"
              step={1}
              aria-label="Until time (IST)"
              value={untilTime}
              onChange={(e) => {
                setUntilTime(e.target.value);
                if (range !== "custom") setRange("custom");
              }}
            />
          </label>
        </div>
      </fieldset>
      </div>
      {error ? (
        <p
          role="alert"
          data-testid="ops-activity-filter-error"
          className="mt-3 rounded-ctl border border-[color-mix(in_srgb,var(--color-late)_30%,transparent)] bg-[var(--color-late-soft)] px-3 py-2 text-[13px] text-[var(--color-late)]"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 lg:justify-end">
        <Button type="button" variant="secondary" onClick={reset} disabled={pending}>
          Reset
        </Button>
        <Button type="button" variant="primary" onClick={apply} disabled={pending}>
          {pending ? "Applying…" : "Apply"}
        </Button>
      </div>
    </div>
  );
}
