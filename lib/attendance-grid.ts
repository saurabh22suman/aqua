import { addDays } from "@/lib/time/tz";

// Member attendance grid (2026-09-15 redesign) — the pure layer behind
// the 15-day, 5×3 GitHub-style grid on the member pages. Kept free of
// db imports so both the server and the client component can share it
// (and so the aggregation rules are unit-testable without Postgres).

export const ATTENDANCE_GRID_DAYS = 15;

export type AttendanceMark = "present" | "absent" | "late";
export type AttendanceDayStatus = AttendanceMark | "none";

export type AttendanceGridRow = {
  sessionId: string;
  sessionDate: string;
  batchName: string;
  status: AttendanceMark;
  // When the coach/staff marked it (ISO instant). Null for rows
  // written before this field existed.
  markedAt: string | null;
};

export type AttendanceDay = {
  date: string;
  status: AttendanceDayStatus;
  isToday: boolean;
  rows: AttendanceGridRow[];
};

export type AttendanceSummary = {
  presentCount: number;
  totalCount: number;
  pct: number | null;
};

// The window ends today and reaches back `days - 1`, so today is always
// the last cell. Dates are the tenant's local dates (the caller
// resolves `today` with todayInZone and threads it through).
export function gridWindow(
  today: string,
  days = ATTENDANCE_GRID_DAYS,
): { from: string; to: string } {
  return { from: addDays(today, -(days - 1)), to: today };
}

export function rowsInWindow<T extends { sessionDate: string }>(
  rows: T[],
  today: string,
  days = ATTENDANCE_GRID_DAYS,
): T[] {
  const { from, to } = gridWindow(today, days);
  return rows.filter((row) => row.sessionDate >= from && row.sessionDate <= to);
}

// One cell per day even when a member has several sessions that day:
// the worst mark wins, so a missed session is never hidden behind a
// present one. The tap-open detail lists every session of the day.
export function dayStatus(rows: Array<{ status: AttendanceMark }>): AttendanceDayStatus {
  if (rows.some((row) => row.status === "absent")) return "absent";
  if (rows.some((row) => row.status === "late")) return "late";
  if (rows.some((row) => row.status === "present")) return "present";
  return "none";
}

// Late counts as attended — the same convention the monthly summary
// has always used (lib/services/attendance-history.ts).
export function summarise(rows: Array<{ status: AttendanceMark }>): AttendanceSummary {
  const presentCount = rows.filter(
    (row) => row.status === "present" || row.status === "late",
  ).length;
  const totalCount = rows.length;
  return {
    presentCount,
    totalCount,
    pct: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : null,
  };
}

// Oldest → newest, exactly `days` entries, so the grid always renders
// 5 columns × 3 rows with today in the last cell.
export function gridDays(
  rows: AttendanceGridRow[],
  today: string,
  days = ATTENDANCE_GRID_DAYS,
): AttendanceDay[] {
  const windowed = rowsInWindow(rows, today, days);
  const byDate = new Map<string, AttendanceGridRow[]>();
  for (const row of windowed) {
    const list = byDate.get(row.sessionDate) ?? [];
    list.push(row);
    byDate.set(row.sessionDate, list);
  }

  const out: AttendanceDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const dayRows = byDate.get(date) ?? [];
    out.push({
      date,
      status: dayStatus(dayRows),
      isToday: date === today,
      rows: dayRows,
    });
  }
  return out;
}
