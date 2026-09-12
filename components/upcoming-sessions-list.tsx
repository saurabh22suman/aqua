"use client";

import { useState } from "react";
import { SessionSubstituteControl } from "@/components/session-substitute-control";
import { SessionLifecycleControl } from "@/components/session-lifecycle-control";
import type { UpcomingSessionRow } from "@/lib/services/coach-schedule";
import type { CoachOption } from "@/lib/services/programs";
import type { TerminologyState } from "@/lib/terminology/keys";
import {
  formatTimeIST,
  formatWallTime24hIST,
  formatWeekdayDateIST,
} from "@/lib/time/tz";
import { EmptyState } from "@/components/ui/EmptyState";

// F3 (R.1) — client island for /owner/sessions. Renders the
// session list with a per-row substitute control. Tracks
// substitutions locally so the substituted coach name updates
// inline without a server round-trip.

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
}: {
  initialSessions: UpcomingSessionRow[];
  coaches: CoachOption[];
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
}) {
  const [sessions, setSessions] = useState(initialSessions);

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

  const grouped = groupByDate(sessions);

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

  return (
    <div className="mt-5 space-y-5">
      {Array.from(grouped.entries()).map(([date, rows]) => (
        <section key={date}>
          <h2 className="font-display text-[13px] font-medium text-ink-3 uppercase tracking-[0.06em]">
            {formatHeaderDate(date)}
          </h2>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {rows.map((s) => (
              <li key={s.id} className="px-4 py-3" data-testid={`session-${s.id}`}>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink truncate">
                    {formatTimeIST(s.startsAt)}&ndash;{formatTimeIST(s.endsAt)}{" "}
                    &middot; {s.batchName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    Coach: <span className="text-ink-2">{s.coachName ?? "Unassigned"}</span>
                  </p>
                </div>
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
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
