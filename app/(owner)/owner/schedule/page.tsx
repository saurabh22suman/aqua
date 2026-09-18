import { requireOwner } from "@/lib/auth/surface-guard";
import { requirePermission } from "@/lib/auth/permission";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { listLocationsAction } from "@/lib/actions/people";
import { getScheduleGridAction } from "@/lib/actions/schedule-grid";
import { todayInZone, addDays, weekdayOf, formatDateIST } from "@/lib/time/tz";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";

// U-04 — owner schedule surface: a week/month grid over the existing
// batches/sessions data with the capacity lane per session and a
// per-location filter. Read-only; the add-session entry point leads
// to the batch editor because sessions are generated from batch
// recurrence (C-19).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampAnchor(value: string | undefined, fallback: string): string {
  return value && DATE_RE.test(value) ? value : fallback;
}

export default async function OwnerSchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; date?: string; location?: string }>;
}) {
  const ctx = await requireOwner();
  requirePermission(ctx, "attendance.read");

  const params = searchParams ? await searchParams : {};
  const timezone = await getTenantTimezoneAction();
  const view = params.view === "month" ? "month" : "week";
  const anchor = clampAnchor(params.date, todayInZone(timezone));
  const locationId = params.location;

  const { fromDate, toDate, days, prevDate, nextDate } = computeWindow(view, anchor);

  const [sessions, locations] = await Promise.all([
    getScheduleGridAction({ fromDate, toDate, ...(locationId ? { locationId } : {}) }),
    listLocationsAction(),
  ]);

  const counts = new Map<string, number>();
  for (const session of sessions) {
    counts.set(session.sessionDate, (counts.get(session.sessionDate) ?? 0) + 1);
  }
  const monthCells =
    view === "month"
      ? buildMonthCells(fromDate, toDate).map((cell) => ({
          ...cell,
          count: counts.get(cell.date) ?? 0,
        }))
      : null;

  const base = (date: string) =>
    `/owner/schedule?view=${view}&date=${date}${locationId ? `&location=${locationId}` : ""}`;

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/sessions" label="Sessions" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">Schedule</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        {view === "week"
          ? `Week of ${formatDateIST(days[0] ?? anchor)} (${timezone})`
          : `Month of ${formatDateIST(days[0] ?? anchor)} (${timezone})`}
        . Each bar is enrolled against the batch&apos;s capacity.
      </p>

      <OwnerScheduleGrid
        view={view}
        locationId={locationId}
        locations={locations}
        sessions={sessions}
        days={days}
        monthCells={monthCells}
        prevHref={base(prevDate)}
        nextHref={base(nextDate)}
        todayHref={`/owner/schedule?view=${view}&date=${todayInZone(timezone)}${
          locationId ? `&location=${locationId}` : ""
        }`}
      />
    </main>
  );
}

type ScheduleWindow = {
  fromDate: string;
  toDate: string;
  days: string[];
  prevDate: string;
  nextDate: string;
};

function computeWindow(view: "week" | "month", anchor: string): ScheduleWindow {
  if (view === "week") {
    const dow = weekdayOf(anchor);
    const monday = addDays(anchor, -(dow === 0 ? 6 : dow - 1));
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    return {
      fromDate: days[0]!,
      toDate: days[6]!,
      days,
      prevDate: addDays(monday, -7),
      nextDate: addDays(monday, 7),
    };
  }

  const monthStart = `${anchor.slice(0, 7)}-01`;
  const nextMonth = `${addDays(monthStart, 32).slice(0, 7)}-01`;
  const lastDay = addDays(nextMonth, -1);
  const days: string[] = [];
  for (let date = monthStart; date <= lastDay; date = addDays(date, 1)) {
    days.push(date);
  }
  return {
    fromDate: monthStart,
    toDate: lastDay,
    days,
    prevDate: addDays(monthStart, -1),
    nextDate: addDays(lastDay, 1),
  };
}

// A Monday-first 6×7 grid covering the month, matching the week view's
// day ordering so a cell and its section read the same way.
function buildMonthCells(
  monthStart: string,
  lastDay: string,
): Array<{ date: string; inMonth: boolean }> {
  const firstDow = weekdayOf(monthStart);
  const gridStart = addDays(monthStart, -(firstDow === 0 ? 6 : firstDow - 1));
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    cells.push({ date, inMonth: date >= monthStart && date <= lastDay });
  }
  return cells;
}
