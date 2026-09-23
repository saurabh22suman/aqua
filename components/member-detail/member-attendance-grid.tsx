"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ATTENDANCE_GRID_DAYS,
  gridDays,
  summarise,
  type AttendanceDay,
  type AttendanceGridRow,
} from "@/lib/attendance-grid";
import {
  ATTENDANCE_MARK_TONE,
  TONE_DOT_CLASS,
  TONE_SURFACE_CLASS,
} from "@/components/ui/StatusBadge";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";

// Member attendance (2026-09-15 redesign) — a 15-day, 5×3 scan grid.
// Green present, yellow late, red absent, neutral no session; today
// carries the accent outline. Tapping a day opens its session detail
// below. The grid is deliberately read-only: coaches and staff mark
// from the register (attendance.mark), and the owner/member/parent
// views of this section cannot modify anything.

// Tone classes come from the shared primitive (the sanctioned home of
// the good/late/warn tokens) so this file never copies them.
const CELL_STYLE: Record<AttendanceDay["status"], string> = {
  present: TONE_SURFACE_CLASS[ATTENDANCE_MARK_TONE.present!]!,
  late: TONE_SURFACE_CLASS[ATTENDANCE_MARK_TONE.late!]!,
  absent: TONE_SURFACE_CLASS[ATTENDANCE_MARK_TONE.absent!]!,
  none: "bg-deck text-ink-3",
};

const DOT_STYLE: Record<AttendanceDay["status"], string> = {
  present: TONE_DOT_CLASS[ATTENDANCE_MARK_TONE.present!]!,
  late: TONE_DOT_CLASS[ATTENDANCE_MARK_TONE.late!]!,
  absent: TONE_DOT_CLASS[ATTENDANCE_MARK_TONE.absent!]!,
  none: `bg-deck border border-line`,
};

const STATUS_LABEL: Record<AttendanceDay["status"], string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  none: "No session",
};

function weekdayShort(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`)
    .toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })
    .slice(0, 2);
}

function dayNumber(dateIso: string): string {
  return String(Number(dateIso.slice(8, 10)));
}

export function MemberAttendanceGrid({
  rows,
  today,
  scopeNote,
  registerBasePath,
}: {
  rows: AttendanceGridRow[];
  // Tenant-local today (the server resolves it with todayInZone).
  today: string;
  scopeNote?: string;
  // Coaches get a jump into the session register to mark/edit; staff
  // hold attendance.mark too. Owner and parent surfaces omit it.
  registerBasePath?: string;
}) {
  const days = gridDays(rows, today, ATTENDANCE_GRID_DAYS);
  const summary = summarise(days.flatMap((day) => day.rows));
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay = days.find((day) => day.date === selected) ?? null;

  return (
    <div className="mt-2 rounded-card border border-line bg-paper p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-[24px] font-semibold">
          {summary.pct === null ? "—" : `${summary.pct}%`}
        </p>
        <p className="text-right text-[12px] text-ink-3">
          {summary.totalCount === 0
            ? "No sessions marked yet"
            : `${summary.presentCount} of ${summary.totalCount} sessions attended`}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Last {ATTENDANCE_GRID_DAYS} days
      </p>

      <div className="mt-2.5 grid grid-cols-5 gap-1.5">
        {days.map((day) => {
          const isSelected = selected === day.date;
          const border = day.isToday
            ? "border-2 border-[var(--accent-strong)]"
            : isSelected
              ? "border-2 border-ink-3"
              : "border border-transparent";
          return (
            <button
              key={day.date}
              type="button"
              aria-label={`${formatDateIST(day.date)}, ${
                day.status === "none" ? "no session" : day.status
              }${day.isToday ? ", today" : ""}`}
              aria-current={day.isToday ? "date" : undefined}
              onClick={() => setSelected(isSelected ? null : day.date)}
              className={`flex aspect-square flex-col items-center justify-center rounded-ctl ${CELL_STYLE[day.status]} ${border}`}
            >
              <span className="text-[11px] uppercase opacity-80">
                {weekdayShort(day.date)}
              </span>
              <span className="text-[13px] font-medium tabular-nums">
                {dayNumber(day.date)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
        {(["present", "late", "absent", "none"] as const).map((status) => (
          <span key={status} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${DOT_STYLE[status]}`} />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>

      {scopeNote ? (
        <p className="mt-2 text-[11px] text-ink-3">{scopeNote}</p>
      ) : null}

      {selectedDay ? (
        <div className="mt-3 border-t border-line pt-2.5">
          <p className="text-[12px] font-medium text-ink">
            {formatDateIST(selectedDay.date)}
          </p>
          {selectedDay.rows.length === 0 ? (
            <p className="mt-1 text-[12px] text-ink-3">
              No session marked this day.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {selectedDay.rows.map((row) => (
                <li
                  key={row.sessionId}
                  className="flex flex-wrap items-center justify-between gap-2 text-[12px]"
                >
                  <span className="text-ink">{row.batchName}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${CELL_STYLE[row.status]}`}
                    >
                      {row.status}
                    </span>
                    {row.markedAt ? (
                      <span className="text-ink-3">
                        {formatTimeIST(row.markedAt)}
                      </span>
                    ) : null}
                    {registerBasePath ? (
                      <Link
                        href={`${registerBasePath}/${row.sessionId}`}
                        className="rounded-pill border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink"
                      >
                        Register
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2.5 text-[11px] text-ink-3">
          Tap a day to see that session&apos;s details.
        </p>
      )}
    </div>
  );
}
