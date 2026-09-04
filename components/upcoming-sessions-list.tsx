"use client";

import { useState } from "react";
import { SessionSubstituteControl } from "@/components/session-substitute-control";
import type { UpcomingSessionRow } from "@/lib/services/coach-schedule";
import type { CoachOption } from "@/lib/services/programs";

// F3 (R.1) — client island for /owner/sessions. Renders the
// session list with a per-row substitute control. Tracks
// substitutions locally so the substituted coach name updates
// inline without a server round-trip.

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

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
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function UpcomingSessionsList({
  initialSessions,
  coaches,
}: {
  initialSessions: UpcomingSessionRow[];
  coaches: CoachOption[];
}) {
  const [sessions, setSessions] = useState(initialSessions);

  if (sessions.length === 0) {
    return (
      <div className="mt-6 rounded-card border border-line bg-paper p-6 text-center">
        <p className="text-[15px] font-medium text-ink-2">No upcoming sessions</p>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          Sessions are generated four weeks ahead from each batch&apos;s
          schedule. Add a batch in the programs board if none exist
          yet.
        </p>
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
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink truncate">
                      {formatTime(s.startsAt.toString())}&ndash;{formatTime(s.endsAt.toString())}{" "}
                      &middot; {s.batchName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      Coach: <span className="text-ink-2">{s.coachName ?? "Unassigned"}</span>
                      {s.status !== "scheduled" ? (
                        <>
                          {" · "}
                          <span className="text-ink-3">{s.status}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <SessionSubstituteControl
                    sessionId={s.id}
                    sessionDate={s.sessionDate}
                    startsAt={formatTime(s.startsAt.toString())}
                    endsAt={formatTime(s.endsAt.toString())}
                    currentCoachName={s.coachName}
                    coaches={coaches}
                    onSubstituted={(result) => {
                      onSubstituted(s.id, result.newCoachName);
                    }}
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
