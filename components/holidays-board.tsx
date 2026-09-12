"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Trash2 } from "lucide-react";
import { addHolidayAction, removeHolidayAction } from "@/lib/actions/holidays";
import type { HolidayRow } from "@/lib/services/holidays";
import { formatDateIST } from "@/lib/time/tz";
import { EmptyState } from "@/components/ui/EmptyState";

// R.3 (docs/five-day-work-guide.md) — owner holiday/closure editor.
// The session generator already skips these dates; this is the surface
// that lets an owner declare them.
export function HolidaysBoard({
  initialHolidays,
}: {
  initialHolidays: HolidayRow[];
}) {
  const router = useRouter();
  const [holidays] = useState(initialHolidays);
  const [name, setName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [recurringYearly, setRecurringYearly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || !holidayDate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addHolidayAction({
        name: name.trim(),
        holidayDate,
        recurringYearly,
      });
      if (res.kind === "error") {
        setError(res.message);
        return;
      }
      setName("");
      setHolidayDate("");
      setRecurringYearly(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(holidayId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await removeHolidayAction({ holidayId });
      if (res.kind === "error") {
        setError(res.message);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Holiday name"
          className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
          data-testid="holiday-name"
        />
        <div>
          <label className="block text-[12px] text-ink-3 mb-1">Date</label>
          <input
            type="date"
            lang="en-IN"
            placeholder="dd/mm/yyyy"
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
            data-testid="holiday-date"
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={recurringYearly}
            onChange={(e) => setRecurringYearly(e.target.checked)}
            className="h-4 w-4"
          />
          Repeats every year on this date
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim() || !holidayDate}
          className="w-full rounded-ctl bg-[var(--accent)] py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
        >
          Add holiday
        </button>
        {error ? <p className="text-[12px] text-ink-2">{error}</p> : null}
      </div>

      {holidays.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper">
          <EmptyState
            title="No holidays yet"
            body="Declare a holiday and the session generator skips it — no empty register at the pool."
          />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-paper">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3.5 py-3">
              <div className="h-9 w-9 rounded-[11px] bg-deck text-ink-3 grid place-items-center flex-none">
                <CalendarOff size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">{h.name}</p>
                <p className="text-[11.5px] text-ink-3">
                  {formatDateIST(h.holidayDate)}
                  {h.recurringYearly ? " · Repeats yearly" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(h.id)}
                disabled={busy}
                aria-label={`Remove ${h.name}`}
                className="flex h-11 w-11 flex-none items-center justify-center rounded-ctl text-ink-3 disabled:opacity-50"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
