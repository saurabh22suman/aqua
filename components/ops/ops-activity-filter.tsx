"use client";

import { OPS_OUTCOMES } from "@/lib/ops-outcomes";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import {
  DATE_RANGE_OPTIONS,
  activityDateRangeBounds,
  buildActivityDateQuery,
  normalizeActivityDate,
} from "./ops-activity-date";

export type ActivityTenant = {
  id: string;
  name: string;
  slug: string;
};
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
  outcomes = OPS_OUTCOMES,
  initial,
}: {
  actions: string[];
  tenants: readonly ActivityTenant[];
  /** The canonical recorded outcomes, handed down by the server. */
  outcomes?: readonly string[];
  initial: {
    action?: string;
    tenantId?: string;
    since?: string;
    until?: string;
    actorId?: string;
    correlationId?: string;
    outcome?: string;
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
  // Ops completion 2026-11-09 — the investigation controls keep the
  // values the URL carried, so a shared link shows what it filtered by.
  const [actorId, setActorId] = useState(initial.actorId ?? "");
  const [correlationId, setCorrelationId] = useState(initial.correlationId ?? "");
  const [outcome, setOutcome] = useState(initial.outcome ?? "");
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
      actorId,
      correlationId,
      outcome,
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
    setActorId("");
    setCorrelationId("");
    setOutcome("");
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

      {/* The INVESTIGATION row: the outcome is a choice, the two ids are
          pasted. None of them reads a person, a phone number or an
          account — they are the values the trail already carries. */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Outcome</span>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any outcome</option>
            {outcomes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Actor id
          </span>
          <Input
            id="ops-activity-actor"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="Any actor"
            autoComplete="off"
            spellCheck={false}
            pattern="[0-9a-fA-F-]{36}"
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Operation reference
          </span>
          <Input
            id="ops-activity-correlation"
            value={correlationId}
            onChange={(e) => setCorrelationId(e.target.value)}
            placeholder="Any operation"
            autoComplete="off"
            spellCheck={false}
            pattern="[0-9a-fA-F-]{36}"
          />
        </label>
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
