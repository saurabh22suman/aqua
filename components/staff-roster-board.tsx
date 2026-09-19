"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import {
  createShiftAction,
  createShiftTemplateAction,
  deleteShiftAction,
  publishRosterAction,
} from "@/lib/actions/shifts";
import type { RosterShiftRow, ShiftTemplateRow } from "@/lib/services/shifts";
import type { StaffRow } from "@/lib/services/staff";
import { addDays, formatTimeIST, formatWeekdayDateIST } from "@/lib/time/tz";

// V-23 — the weekly roster builder's interactive half: publish, add a
// shift, delete a shift, and manage the shift templates the builder
// starts from. The week frame and day sections are server-rendered by
// /owner/staff/roster; this island owns the mutations only.
//
// Day cells stack vertically at 390px (no horizontal scroll), matching
// the owner schedule grid. Touch targets stay at the 44px floor.

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const STATUS_LABEL: Record<string, string> = {
  rostered: "Rostered",
  worked: "Worked",
  absent: "Absent",
  leave: "Leave",
};

export function StaffRosterBoard({
  weekStart,
  shifts,
  templates,
  staff,
  locations,
  defaultLocationId,
}: {
  weekStart: string;
  shifts: RosterShiftRow[];
  templates: ShiftTemplateRow[];
  staff: StaffRow[];
  locations: Array<{ id: string; name: string }>;
  defaultLocationId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [staffId, setStaffId] = useState<string>(staff[0]?.id ?? "");
  const [shiftDate, setShiftDate] = useState(weekStart);
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("10:00");
  const [templateId, setTemplateId] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");

  const [tplName, setTplName] = useState("");
  const [tplStart, setTplStart] = useState("06:00");
  const [tplEnd, setTplEnd] = useState("10:00");
  const [tplDays, setTplDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? null : (result.error ?? "Something went wrong."));
      if (result.ok) router.refresh();
    });
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = new Map<string, RosterShiftRow[]>();
  for (const shift of shifts) {
    const list = byDay.get(shift.shiftDate) ?? [];
    list.push(shift);
    byDay.set(shift.shiftDate, list);
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (template) {
      setStartTime(template.startTime.slice(0, 5));
      setEndTime(template.endTime.slice(0, 5));
      if (locations.some((l) => l.id === template.locationId)) {
        setLocationId(template.locationId);
      }
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="md"
          disabled={pending}
          onClick={() =>
            run(() =>
              publishRosterAction({
                weekStart,
                ...(locationId ? { locationId } : {}),
              }),
            )
          }
        >
          Publish this week
        </Button>
        <span className="text-[12.5px] text-ink-3">
          Draft shifts stay invisible to staff until published.
        </span>
      </div>

      {message ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-2">
          {message}
        </p>
      ) : null}

      <section className="mt-5 rounded-card border border-line bg-paper p-4">
        <h2 className="font-display text-[15px] font-semibold">Add a shift</h2>
        {staff.length === 0 || locations.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">
            Add a staff member and a location before building the roster.
          </p>
        ) : (
          <div className="mt-3 grid gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">Staff</span>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} · {s.staffType}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] text-ink-3">Date</span>
                <DateField value={shiftDate} onChange={setShiftDate} />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] text-ink-3">
                  Template (optional)
                </span>
                <select
                  value={templateId}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
                >
                  <option value="">Custom times</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
            {locations.length > 1 ? (
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-3">Location</span>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              variant="primary"
              size="md"
              disabled={pending || !staffId || !locationId}
              onClick={() =>
                run(() =>
                  createShiftAction({
                    staffId,
                    locationId,
                    shiftDate,
                    startTime,
                    endTime,
                    ...(templateId ? { templateId } : {}),
                  }),
                )
              }
            >
              <Plus size={16} /> Add shift
            </Button>
          </div>
        )}
      </section>

      <div className="mt-5 space-y-4">
        {days.map((day) => {
          const rows = byDay.get(day) ?? [];
          return (
            <section key={day}>
              <h2 className="text-[13px] font-semibold text-ink-2">
                {formatWeekdayDateIST(`${day}T12:00:00Z`)}
              </h2>
              {rows.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-ink-3">No shifts.</p>
              ) : (
                <ul className="mt-1.5">
                  {rows.map((shift) => (
                    <li
                      key={shift.id}
                      className="mb-2 flex items-center gap-3 rounded-ctl border border-line bg-paper px-3.5 py-3 last:mb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">
                          {shift.staffName}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-3">
                          {formatTimeIST(shift.startAt)} –{" "}
                          {formatTimeIST(shift.endAt)} ·{" "}
                          {STATUS_LABEL[shift.status] ?? shift.status} ·{" "}
                          {shift.publishedAt ? "Published" : "Draft"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Delete shift for ${shift.staffName}`}
                        onClick={() => run(() => deleteShiftAction(shift.id))}
                        className="grid h-11 w-11 flex-none place-items-center rounded-ctl text-ink-3 hover:bg-deck disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <details className="mt-6 rounded-card border border-line bg-paper p-4">
        <summary className="min-h-11 cursor-pointer text-[14px] font-medium">
          Shift templates ({templates.length})
        </summary>
        <div className="mt-3 grid gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-3">Name</span>
            <input
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              placeholder="Morning shift"
              className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] text-ink-3">Start</span>
              <input
                type="time"
                value={tplStart}
                onChange={(e) => setTplStart(e.target.value)}
                className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] text-ink-3">End</span>
              <input
                type="time"
                value={tplEnd}
                onChange={(e) => setTplEnd(e.target.value)}
                className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
              />
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 text-[11px] text-ink-3">Days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const active = tplDays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setTplDays((prev) =>
                        active
                          ? prev.filter((v) => v !== d.value)
                          : [...prev, d.value],
                      )
                    }
                    className={`min-h-11 min-w-11 rounded-ctl border px-3 text-[13px] ${
                      active
                        ? "border-ink-2 bg-deck font-semibold text-ink"
                        : "border-line bg-paper text-ink-3"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Button
            variant="secondary"
            size="md"
            disabled={pending || !tplName.trim() || !locationId || tplDays.length === 0}
            onClick={() =>
              run(() =>
                createShiftTemplateAction({
                  locationId,
                  name: tplName,
                  startTime: tplStart,
                  endTime: tplEnd,
                  daysOfWeek: tplDays,
                }),
              )
            }
          >
            Save template
          </Button>
        </div>
      </details>
    </div>
  );
}
