"use client";

import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { TimeField } from "@/components/ui/TimeField";
import { useCallback, useEffect, useId, useState } from "react";
import {
  getBusinessHoursAction,
  setBusinessHoursAction,
} from "@/lib/actions/locations";

// U-07 — the business-hours editor for one location. Hours live in
// the config registry (`operations.business_hours`, location scope),
// so the ops console and any later surface read the same value. An
// unconfigured location loads as empty and is displayed as "Not set
// yet" rather than guessed at.

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type Day = (typeof DAYS)[number] | string;
type DayHours = { day: string; closed: boolean; open: string; close: string };


function fullWeek(loaded: DayHours[]): DayHours[] {
  return DAYS.map(
    (day) =>
      loaded.find((d) => d.day === day) ?? {
        day,
        closed: true,
        open: "06:00",
        close: "21:00",
      },
  );
}

export function BusinessHoursEditor({
  locationId,
  canWrite,
}: {
  locationId: string;
  canWrite: boolean;
}) {
  const [days, setDays] = useState<DayHours[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [timeValidity, setTimeValidity] = useState<
    Record<string, { open?: boolean; close?: boolean }>
  >({});

  // One editor is mounted per location, so two locations on one page emit
  // the SAME time ids when they are derived from the weekday alone. A
  // native `<label for>` and an `aria-describedby` name the FIRST element
  // carrying an id, so the second location's labels and help text would
  // point at the FIRST location's controls.
  //
  // A per-mounted-instance suffix gives every field, label and help text
  // exactly one owner. useId is stable across renders and unique per
  // instance; the token is reduced to characters that are safe in an id and
  // in a selector. The `hours-<day>-open` / `hours-<day>-close` PREFIX is
  // unchanged — the reviewer's journey selects `fieldset[id^="hours-monday-
  // open"]` — so the shared TimeField contract and the group's accessible
  // name are untouched.
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/g, "");

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const hours = await getBusinessHoursAction(locationId);
      setDays(hours.days.length > 0 ? fullWeek(hours.days) : fullWeek([]));
    } catch {
      setLoadError(true);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-[12.5px] text-ink-2">
          Could not load hours — this is a read failure, not &ldquo;not set&rdquo;.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-1 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!days) {
    return <p className="mt-2 text-[12.5px] text-ink-3">Loading hours…</p>;
  }

  const configured = days.some((d) => !d.closed);
  const timesValid = days.every(
    (d) =>
      d.closed ||
      (timeValidity[d.day]?.open !== false &&
        timeValidity[d.day]?.close !== false),
  );

  function update(day: Day, patch: Partial<DayHours>) {
    setDays((current) =>
      (current ?? []).map((d) => (d.day === day ? { ...d, ...patch } : d)),
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-[12px] font-medium text-ink-2">Business hours</p>
      {!configured ? (
        <p className="mt-0.5 text-[12px] text-ink-3">
          Not set yet. Turn a day on and save to publish hours.
        </p>
      ) : null}

      <ul className="mt-2 space-y-1.5">
        {days.map((d) => (
          <li key={d.day} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="w-[72px] capitalize text-ink-2">{d.day}</span>
            {/* A neutral wrapper: the shared Checkbox renders its own
                label, and a label inside a label is not valid. */}
            <span className="flex min-h-[44px] items-center gap-1.5">
              <Checkbox
                checked={!d.closed}
                disabled={!canWrite}
                onCheckedChange={(checked) => update(d.day, { closed: !checked })}
                aria-label={`${d.day} open`}
              >
                {d.closed ? "Closed" : "Open"}
              </Checkbox>
            </span>
            {!d.closed ? (
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <TimeField
                  id={`hours-${d.day}-open-${instanceId}`}
                  label={`${d.day.charAt(0).toUpperCase()}${d.day.slice(1)} opening time`}
                  value={d.open}
                  disabled={!canWrite}
                  onChange={(value) => update(d.day, { open: value })}
                  onValidityChange={(valid) =>
                    setTimeValidity((current) => ({
                      ...current,
                      [d.day]: { ...current[d.day], open: valid },
                    }))
                  }
                />
                <TimeField
                  id={`hours-${d.day}-close-${instanceId}`}
                  label={`${d.day.charAt(0).toUpperCase()}${d.day.slice(1)} closing time`}
                  value={d.close}
                  disabled={!canWrite}
                  onChange={(value) => update(d.day, { close: value })}
                  onValidityChange={(valid) =>
                    setTimeValidity((current) => ({
                      ...current,
                      [d.day]: { ...current[d.day], close: valid },
                    }))
                  }
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canWrite ? (
        <Button
            variant="primary"
            size="md"
            className="mt-2"
            type="button"
          disabled={busy || !timesValid}
          onClick={() => {
            if (!timesValid) return;
            setBusy(true);
            setMessage(null);
            void (async () => {
              try {
                const result = await setBusinessHoursAction({
                  locationId,
                  hours: { days },
                });
                setMessage(result.ok ? "Hours saved." : result.error);
              } catch {
                setMessage(
                  "The hours did not reach the server. Your edits are kept — try again.",
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
          >
          {busy ? "Saving…" : "Save hours"}
        </Button>
      ) : null}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
