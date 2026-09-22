import Link from "next/link";
import type { GridSessionRow } from "@/lib/services/schedule-grid";
import { formatDateIST, formatWallTime24hIST } from "@/lib/time/tz";

// U-04 — the owner schedule grid. Week view renders seven stacked day
// sections (no horizontal scroll at 390px); month view adds a compact
// 7-column month strip whose day cells link back into the week view.
// Every session row carries the capacity lane strip — the design's
// signature element, here in its owner meaning (enrolled/capacity).
//
// Add-session lives behind a link to the batch editor: sessions are
// materialised from a batch's recurrence (C-19), so inventing a
// standalone session form would create rows the generator does not
// know about.

export function OwnerScheduleGrid({
  view,
  locationId,
  locations,
  sessions,
  days,
  monthCells,
  prevHref,
  nextHref,
  todayHref,
}: {
  view: "week" | "month";
  locationId?: string;
  locations: Array<{ id: string; name: string }>;
  sessions: GridSessionRow[];
  days: string[];
  monthCells: Array<{ date: string; inMonth: boolean; count: number }> | null;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  const byDay = new Map<string, GridSessionRow[]>();
  for (const session of sessions) {
    const list = byDay.get(session.sessionDate) ?? [];
    list.push(session);
    byDay.set(session.sessionDate, list);
  }
  const totalSessions = sessions.length;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={prevHref}
          className="flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          ← Prev
        </Link>
        <Link
          href={todayHref}
          className="flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          Today
        </Link>
        <Link
          href={nextHref}
          className="flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          Next →
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <ViewLink label="Week" active={view === "week"} view="week" locationId={locationId} />
          <ViewLink label="Month" active={view === "month"} view="month" locationId={locationId} />
        </div>
      </div>

      {locations.length > 1 ? (
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-ink-3">
              Location
            </span>
            <select
              name="location"
              defaultValue={locationId ?? ""}
              className="min-h-[44px] rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none"
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-4 text-[13px] font-semibold text-paper"
          >
            Apply
          </button>
        </form>
      ) : null}

      {monthCells ? (
        <div className="mt-4 rounded-card border border-line bg-paper p-3">
          <table className="w-full table-fixed border-collapse text-center">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <th key={`${d}-${i}`} className="py-1 font-medium">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chunk(monthCells, 7).map((week, wi) => (
                <tr key={wi}>
                  {week.map((cell) => (
                    <td key={cell.date} className="p-0.5 align-top">
                      {cell.inMonth ? (
                        <Link
                          href={`/owner/schedule?view=week&date=${cell.date}${
                            locationId ? `&location=${locationId}` : ""
                          }`}
                          className={`flex min-h-[44px] flex-col items-center justify-center rounded-ctl text-[13px] ${
                            cell.count > 0
                              ? "bg-water-soft text-ink"
                              : "text-ink-3"
                          }`}
                        >
                          <span className="tabular-nums">
                            {Number(cell.date.slice(8, 10))}
                          </span>
                          {cell.count > 0 ? (
                            <span className="text-[11px] tabular-nums text-water">
                              {cell.count}
                            </span>
                          ) : null}
                        </Link>
                      ) : (
                        <span className="block min-h-[44px]" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {totalSessions === 0 ? (
        <div className="mt-4 rounded-card border border-line bg-paper p-4 text-center">
          <p className="text-[14px] font-medium">
            No sessions scheduled in this {view}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Sessions come from a batch&apos;s weekly schedule. Add or edit a
            batch to change what appears here.
          </p>
          <Link
            href="/owner/programs"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-pill bg-[var(--accent-strong)] px-5 text-[13px] font-semibold text-paper"
          >
            Manage batches
          </Link>
        </div>
      ) : (
        <div className="mt-4 space-y-4 md:grid md:grid-cols-7 md:gap-3 md:space-y-0">
          {days.map((day) => {
            const daySessions = byDay.get(day) ?? [];
            return (
              <section key={day}>
                <h2 className="font-display text-[14px] font-semibold">
                  {formatDateIST(day)}
                  <span className="ml-2 text-[12px] font-normal text-ink-3 tabular-nums">
                    {daySessions.length} session
                    {daySessions.length === 1 ? "" : "s"}
                  </span>
                </h2>
                {daySessions.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    Nothing scheduled.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
                    {daySessions.map((session) => (
                      <SessionRow key={session.id} session={session} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Link
        href="/owner/programs"
        className="mt-4 inline-flex min-h-[44px] items-center rounded-pill border border-line bg-paper px-4 text-[13px] font-medium text-ink"
      >
        Add a session (via a batch)
      </Link>
    </div>
  );
}

function ViewLink({
  label,
  active,
  view,
  locationId,
}: {
  label: string;
  active: boolean;
  view: string;
  locationId?: string;
}) {
  return (
    <Link
      href={`/owner/schedule?view=${view}${locationId ? `&location=${locationId}` : ""}`}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[44px] items-center rounded-ctl border px-3 text-[13px] ${
        active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2"
      }`}
    >
      {label}
    </Link>
  );
}

function SessionRow({ session }: { session: GridSessionRow }) {
  const pct =
    session.capacity > 0
      ? Math.min(100, Math.round((session.enrolled / session.capacity) * 100))
      : 0;
  const fill =
    session.status === "cancelled"
      ? "bg-ink-3"
      : pct < 50
        ? "bg-warn"
        : "bg-water";
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-medium text-ink">
          {formatWallTime24hIST(session.startsAt)}–{formatWallTime24hIST(session.endsAt)}{" "}
          · {session.batchName}
        </span>
        <span className="text-[12px] text-ink-3 tabular-nums">
          {session.enrolled} / {session.capacity}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-deck">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11.5px] text-ink-3">
        {session.locationName ?? "No location"}
        {session.coachName ? ` · ${session.coachName}` : ""}
        {session.status !== "scheduled" ? ` · ${session.status}` : ""}
      </p>
    </li>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
