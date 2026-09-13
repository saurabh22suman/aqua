"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { SessionSubstituteControl } from "@/components/session-substitute-control";
import { SessionLifecycleControl } from "@/components/session-lifecycle-control";
import type { UpcomingSessionRow } from "@/lib/services/coach-schedule";
import type { CoachOption } from "@/lib/services/programs";
import type { TerminologyState } from "@/lib/terminology/keys";
import {
  addDays,
  formatTimeIST,
  formatWallTime24hIST,
  formatWeekdayDateIST,
  todayInZone,
} from "@/lib/time/tz";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

// F3 (R.1) — client island for /owner/sessions. Renders the
// session list with a per-row substitute control. Tracks
// substitutions locally so the substituted coach name updates
// inline without a server round-trip.
//
// 2026-09-13 UI/UX audit §11 #5: the 14-day unpaginated list made a
// ~10,650px wall where every row led with three permanent action
// buttons. The default window is now "today" when there is anything
// today (else the coming week, else the full window), and a row's
// exception actions live behind one "Manage" control. The full list is
// still one tap away — nothing was removed.

type RangeKey = "today" | "week" | "all";

function groupByDate(rows: UpcomingSessionRow[]): Map<string, UpcomingSessionRow[]> {
  const out = new Map<string, UpcomingSessionRow[]>();
  for (const r of rows) {
    const list = out.get(r.sessionDate) ?? [];
    list.push(r);
    out.set(r.sessionDate, list);
  }
  return out;
}

function formatHeaderDate(dateStr: string): string {
  return formatWeekdayDateIST(dateStr);
}

export function UpcomingSessionsList({
  initialSessions,
  coaches,
  terminology,
  timezone = "Asia/Kolkata",
}: {
  initialSessions: UpcomingSessionRow[];
  coaches: CoachOption[];
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
  timezone?: string;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [manageId, setManageId] = useState<string | null>(null);

  const today = todayInZone(timezone);
  const weekEnd = addDays(today, 6);

  // Initial choice only — the user owns the control after mount.
  // "Today" when anything is today, else the coming week, else the
  // full window (so an empty short window never looks like "nothing
  // scheduled" when sessions exist later in the fortnight).
  const defaultRange: RangeKey = initialSessions.some((s) => s.sessionDate === today)
    ? "today"
    : initialSessions.some((s) => s.sessionDate >= today && s.sessionDate <= weekEnd)
      ? "week"
      : "all";
  const [range, setRange] = useState<RangeKey>(defaultRange);

  const filtered = useMemo(() => {
    if (range === "all") return sessions;
    const end = range === "today" ? today : weekEnd;
    return sessions.filter(
      (s) => s.sessionDate >= today && s.sessionDate <= end,
    );
  }, [sessions, range, today, weekEnd]);

  function onSubstituted(sessionId: string, newCoachName: string) {
    setSessions((rows) =>
      rows.map((r) =>
        r.id === sessionId ? { ...r, coachName: newCoachName } : r,
      ),
    );
  }

  // R.4 — a cancel/reschedule updates the row in place (and the date
  // grouping, which keys off sessionDate) until the refresh lands.
  function onLifecycleChanged(
    sessionId: string,
    next: { status: string; sessionDate: string; startsAt?: string; endsAt?: string },
  ) {
    setSessions((rows) =>
      rows.map((r) =>
        r.id === sessionId
          ? {
              ...r,
              status: next.status,
              sessionDate: next.sessionDate,
              startsAt: next.startsAt ? new Date(next.startsAt) : r.startsAt,
              endsAt: next.endsAt ? new Date(next.endsAt) : r.endsAt,
            }
          : r,
      ),
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="mt-6 rounded-card border border-line bg-paper">
        <EmptyState
          title="No upcoming sessions"
          body="Sessions are generated four weeks ahead from each batch's schedule. Add a batch in the programs board if none exist yet."
        />
      </div>
    );
  }

  const grouped = groupByDate(filtered);
  const RANGES: { key: RangeKey; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "Next 7 days" },
    { key: "all", label: "All 14 days" },
  ];

  return (
    <div className="mt-4">
      <div
        role="group"
        aria-label="Session window"
        className="flex gap-2"
        data-testid="session-range"
      >
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={range === r.key}
            onClick={() => {
              setRange(r.key);
              setManageId(null);
            }}
            className={`min-h-11 rounded-ctl border px-3 py-2 text-[13px] font-medium ${
              range === r.key
                ? "border-ink bg-paper text-ink"
                : "border-line bg-paper text-ink-3"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-card border border-line bg-paper">
          <EmptyState
            title="Nothing in this window"
            body="No sessions fall in the selected window. Show the full 14 days to see everything scheduled."
            action={{ label: "Show all 14 days", onClick: () => setRange("all") }}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {Array.from(grouped.entries()).map(([date, rows]) => (
            <section key={date}>
              <h2 className="font-display text-[13px] font-medium text-ink-3 uppercase tracking-[0.06em]">
                {formatHeaderDate(date)}
              </h2>
              <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
                {rows.map((s) => {
                  const open = manageId === s.id;
                  return (
                    <li key={s.id} className="px-4 py-3" data-testid={`session-${s.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-ink truncate">
                            {formatTimeIST(s.startsAt)}&ndash;{formatTimeIST(s.endsAt)}{" "}
                            &middot; {s.batchName}
                          </p>
                          <p className="mt-0.5 text-[12px] text-ink-3">
                            Coach: <span className="text-ink-2">{s.coachName ?? "Unassigned"}</span>
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          onClick={() => setManageId(open ? null : s.id)}
                          aria-expanded={open}
                          className="flex-none"
                          data-testid={`manage-session-${s.id}`}
                        >
                          <SlidersHorizontal size={13} aria-hidden="true" />
                          {open ? "Close" : "Manage"}
                        </Button>
                      </div>
                      {open ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <SessionSubstituteControl
                            sessionId={s.id}
                            sessionDate={s.sessionDate}
                            startsAt={formatTimeIST(s.startsAt)}
                            endsAt={formatTimeIST(s.endsAt)}
                            currentCoachName={s.coachName}
                            coaches={coaches}
                            onSubstituted={(result) => {
                              onSubstituted(s.id, result.newCoachName);
                            }}
                            terminology={terminology}
                          />
                          <SessionLifecycleControl
                            sessionId={s.id}
                            sessionDate={s.sessionDate}
                            startWall={formatWallTime24hIST(s.startsAt)}
                            endWall={formatWallTime24hIST(s.endsAt)}
                            status={s.status}
                            onChanged={(next) => onLifecycleChanged(s.id, next)}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
