"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createShiftTemplateAction } from "@/lib/actions/shifts";
import type { ShiftTemplateRow } from "@/lib/services/shifts";

// V-23 — the roster builder's template editor: the named wall-time
// blocks a shift is added from. Self-contained island so the board
// itself stays focused on the week.

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export function ShiftTemplateEditor({
  templates,
  locationId,
}: {
  templates: ShiftTemplateRow[];
  locationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("10:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);

  function save() {
    startTransition(async () => {
      const result = await createShiftTemplateAction({
        locationId,
        name,
        startTime,
        endTime,
        daysOfWeek: days,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setName("");
      router.refresh();
    });
  }

  return (
    <details className="mt-6 rounded-card border border-line bg-paper p-4">
      <summary className="min-h-11 cursor-pointer text-[14px] font-medium">
        Shift templates ({templates.length})
      </summary>
      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-3">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning shift"
            className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] text-ink-3">Start</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] text-ink-3">End</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
            />
          </label>
        </div>
        <fieldset>
          <legend className="mb-1 text-[11px] text-ink-3">Days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const active = days.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setDays((prev) =>
                      active
                        ? prev.filter((v) => v !== day.value)
                        : [...prev, day.value],
                    )
                  }
                  className={`min-h-11 min-w-11 rounded-ctl border px-3 text-[13px] ${
                    active
                      ? "border-ink-2 bg-deck font-semibold text-ink"
                      : "border-line bg-paper text-ink-3"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Button
          variant="secondary"
          size="md"
          disabled={pending || !name.trim() || !locationId || days.length === 0}
          onClick={save}
        >
          Save template
        </Button>
        {error ? (
          <p role="alert" className="text-[12.5px] text-ink-2">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
