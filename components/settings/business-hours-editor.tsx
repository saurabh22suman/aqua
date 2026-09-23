"use client";

import { useCallback, useEffect, useState } from "react";
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

const inputClass =
  "rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const hours = await getBusinessHoursAction(locationId);
    setDays(hours.days.length > 0 ? fullWeek(hours.days) : fullWeek([]));
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!days) {
    return <p className="mt-2 text-[12.5px] text-ink-3">Loading hours…</p>;
  }

  const configured = days.some((d) => !d.closed);

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
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!d.closed}
                disabled={!canWrite}
                onChange={(e) => update(d.day, { closed: !e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-[12px] text-ink-3">
                {d.closed ? "Closed" : "Open"}
              </span>
            </label>
            {!d.closed ? (
              <span className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={d.open}
                  disabled={!canWrite}
                  onChange={(e) => update(d.day, { open: e.target.value })}
                  className={`${inputClass} min-w-0`}
                />
                <span className="text-ink-3">–</span>
                <input
                  type="time"
                  value={d.close}
                  disabled={!canWrite}
                  onChange={(e) => update(d.day, { close: e.target.value })}
                  className={`${inputClass} min-w-0`}
                />
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {canWrite ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setMessage(null);
            void (async () => {
              const result = await setBusinessHoursAction({
                locationId,
                hours: { days },
              });
              setMessage(result.ok ? "Hours saved." : result.error);
              setBusy(false);
            })();
          }}
          className="mt-2 min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save hours"}
        </button>
      ) : null}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
