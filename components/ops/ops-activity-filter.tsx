"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import {
  DATE_RANGE_OPTIONS,
  activityDateRangeBounds,
  buildActivityDateQuery,
  normalizeActivityDate,
} from "./ops-activity-date";

// Ops redesign (28 October 2026) — the activity filter.
//
// The old filter asked for a tenant UUID in a free-text box. The
// operator investigating a problem knows the club's NAME, not its id —
// so the filter could not be used at the moment it was needed. The
// tenant is now a PICKER over the real tenant list, labelled by name.
//
// THE DATE BOUNDS (human revision, 31 October 2026): the filter asks
// for DATES, not for instants. There is no hour, no minute, no AM/PM
// and no seconds control — an operator is looking for "what happened
// on the 28th". The two bounds are the shared DateField, so the date is
// CHOSEN from the product's calendar, and the query carries the
// canonical `yyyy-mm-dd` the operator picked.
//
//   - The range choices are date ranges: Any date, Today, Last 7 days,
//     Last 30 days, Custom. There is no rolling "last 24 hours".
//   - A URL that carries bounds shows "Custom", never "Any date" — so
//     the operator can SEE that a bound is active.
//   - A relative range shows its TRUTHFUL visible bounds: the same
//     calendar dates it puts in the query.
//   - The start is never after the end, and a bound that cannot be read
//     is REFUSED, never quietly dropped into an unfiltered read.
//
// The filter submits its own query (changing the URL via shallow
// routing would not re-run the server data fetch unless React Server
// Components re-render).

export type ActivityTenant = {
  id: string;
  name: string;
  slug: string;
};

// The pure date/query model lives in components/ops/ops-activity-date.ts
// (it is asserted on its own); it is re-exported here so the island's
// public surface does not change.
export {
  DATE_RANGE_OPTIONS,
  activityDateRangeBounds,
  buildActivityDateQuery,
  normalizeActivityDate,
  type ActivityDateFilterState,
  type ActivityQueryResult,
} from "./ops-activity-date";

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
  const inbound = useMemo(() => {
    const sinceRaw = initial.since ?? "";
    const untilRaw = initial.until ?? "";
    const since = sinceRaw ? normalizeActivityDate(sinceRaw) : null;
    const until = untilRaw ? normalizeActivityDate(untilRaw) : null;
    return {
      // An inbound URL that carries bounds is a CUSTOM filter — it is
      // never presented as "Any date", which would hide an active bound.
      range: sinceRaw || untilRaw ? "custom" : "",
      sinceDate: since ?? "",
      untilDate: until ?? "",
      // A bound that cannot be read is REFUSED, never dropped.
      refused: Boolean((sinceRaw && !since) || (untilRaw && !until)),
    };
  }, [initial.since, initial.until]);

  const [action, setAction] = useState(initial.action ?? "");
  const [tenantId, setTenantId] = useState(initial.tenantId ?? "");
  const [range, setRange] = useState(inbound.range);
  const [sinceDate, setSinceDate] = useState(inbound.sinceDate);
  const [untilDate, setUntilDate] = useState(inbound.untilDate);
  const [refused, setRefused] = useState(inbound.refused);
  // Every bound reports its own validity, so an unfinished or impossible
  // date can never be applied behind the operator's back.
  const [sinceValid, setSinceValid] = useState(true);
  const [untilValid, setUntilValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * A hand-edited bound makes the window CUSTOM: the relative range is
   * no longer what is on screen, so the operator is never shown a
   * relative range that no longer describes the filter.
   */
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
      // Any date clears the bounds.
      setSinceDate("");
      setUntilDate("");
      return;
    }
    const bounds = activityDateRangeBounds(next);
    if (bounds) {
      // A relative range shows its truthful bounds.
      setSinceDate(bounds.since);
      setUntilDate(bounds.until);
    }
  }

  function apply() {
    // A bound the operator can see but that cannot be read is REFUSED,
    // never submitted: an unreadable filter is not a filter they meant.
    if (refused) {
      setError("That date filter is not a real date.");
      return;
    }
    if (!sinceValid) {
      setError("Enter a real start date.");
      return;
    }
    if (!untilValid) {
      setError("Enter a real end date.");
      return;
    }
    const result = buildActivityDateQuery({
      action,
      tenantId,
      range,
      sinceDate,
      untilDate,
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
            {DATE_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {/* The BOUNDS on their own row: two dates, each chosen from the
          product's calendar. */}
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor="ops-activity-since-date"
            className="mb-1 block text-[12px] font-medium text-ink-2"
          >
            Since date (IST)
          </label>
          <DateField
            id="ops-activity-since-date"
            value={sinceDate}
            onChange={edit(setSinceDate)}
            onValidityChange={setSinceValid}
            formatHint="sr-only"
            calendarLabel="Choose start date"
          />
        </div>
        <div className="min-w-0">
          <label
            htmlFor="ops-activity-until-date"
            className="mb-1 block text-[12px] font-medium text-ink-2"
          >
            Until date (IST)
          </label>
          <DateField
            id="ops-activity-until-date"
            value={untilDate}
            onChange={edit(setUntilDate)}
            onValidityChange={setUntilValid}
            formatHint="sr-only"
            calendarLabel="Choose end date"
          />
        </div>
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
