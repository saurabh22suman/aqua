"use client";

import { useMemo, useState } from "react";
import { SessionSubstituteControl } from "@/components/session-substitute-control";
import { SessionLifecycleControl } from "@/components/session-lifecycle-control";
import { SessionRangeSheet, type SessionRangeKey, type SessionRange } from "@/components/owner-approved/operations/session-range-sheet";
import type { UpcomingSessionRow } from "@/lib/services/coach-schedule";
import type { CoachOption } from "@/lib/services/programs";
import { type TerminologyState } from "@/lib/terminology/keys";
import {
  addDays,
  daysAheadWindow,
  formatTimeIST,
  formatWallTime24hIST,
  formatWeekdayDateIST,
} from "@/lib/time/tz";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { StatusBadge, SESSION_STATUS_TONE } from "@/components/ui/StatusBadge";
import { SectionHeading } from "@/components/ui/PageHeader";

// F3 (R.1) — client island for /owner/sessions.
//
// Owner OpenPen (29 October 2026): the 14-day window is a management
// list. Each row states its lifecycle. Manage opens the controls in
// that row so the date, venue and coach stay beside the edit.
//
// 2026-09-13 UI/UX audit §11 #5: the default window is "today" when
// there is anything today (else the coming week, else the full window),
// and a row's exception actions live behind one Manage control.

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
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

export function UpcomingSessionsList({
  initialSessions,
  coaches,
  terminology,
  timezone = "Asia/Kolkata",
  canManage,
  compactOwner = false,
  dateWindow,
}: {
  initialSessions: UpcomingSessionRow[];
  coaches: CoachOption[];
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
  timezone?: string;
  // R10 (2026-10-13 role-workflow audit) — independent write gate.
  // Substitute/cancel/reschedule require programs.write; a reader
  // without it keeps the read-only list.
  canManage: boolean;
  compactOwner?: boolean;
  dateWindow?: { fromDate: string; toDate: string };
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [manageId, setManageId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [coverageOnly, setCoverageOnly] = useState(false);

  const { fromDate: today, toDate: fullEnd } = dateWindow ?? daysAheadWindow(timezone, 14);
  const weekEnd = addDays(today, 6);

  // Initial choice only — the user owns the control after mount.
  const defaultRange: SessionRangeKey = initialSessions.some((s) => s.sessionDate === today)
    ? "today"
    : initialSessions.some((s) => s.sessionDate >= today && s.sessionDate <= weekEnd)
      ? "week"
      : "all";
  const [range, setRange] = useState<SessionRangeKey>(defaultRange);

  function selectRange(next: SessionRangeKey) {
    setRange(next);
    setManageId(null);
    setNotice(null);
  }

  const inWindow = useMemo(() => {
    if (range === "all") return sessions;
    const end = range === "today" ? today : weekEnd;
    return sessions.filter(session => session.sessionDate >= today && session.sessionDate <= end);
  }, [sessions, range, today, weekEnd]);

  const withoutCoach = inWindow.filter(session =>
    !session.coachName && (session.status === "scheduled" || session.status === "rescheduled"),
  );
  const filtered = coverageOnly ? withoutCoach : inWindow;

  function onSubstituted(sessionId: string, newCoachName: string) {
    setNotice(`Substitute saved. ${newCoachName} is assigned.`);
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
    const isCancelled = next.status === "cancelled";
    setNotice(isCancelled ? "Session cancelled." : `Session updated for ${formatWeekdayDateIST(next.sessionDate)}.`);
    if (!isCancelled && range !== "all" &&
        (next.sessionDate < today || next.sessionDate > (range === "today" ? today : weekEnd))) {
      setRange("all");
    }
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
      ).sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime()),
    );
  }

  if (sessions.length === 0) {
    return (
      <section className="rounded-card border border-line bg-paper p-5">
        <EmptyState
          title="No upcoming sessions"
          body="Sessions are generated four weeks ahead from each batch's schedule. Add a batch in the programs board if none exist yet."
        />
      </section>
    );
  }

  const grouped = groupByDate(filtered);
  const ranges: SessionRange[] = [
    { key: "today", label: "Today", end: today },
    { key: "week", label: "Next 7 days", end: weekEnd },
    { key: "all", label: compactOwner ? "Full window" : "All 14 days", end: fullEnd },
  ];

  return (
    <div>
      <div
        role="group"
        aria-label="Session window"
        className={compactOwner ? "grid max-w-md grid-cols-[minmax(0,1fr)_auto] gap-2" : "owner-work-panel flex flex-wrap items-center gap-2"}
        data-testid="session-range"
      >
        {compactOwner ? (
          <SessionRangeSheet ranges={ranges} from={today} selected={range} onSelect={selectRange} />
        ) : ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={range === r.key}
            onClick={() => selectRange(r.key)}
            className={`min-h-11 rounded-ctl border px-3 py-2 text-[13px] font-medium ${
              range === r.key
                ? "border-[var(--accent-strong)] bg-[var(--control-surface-action)] text-[var(--accent-ink)]"
                : "border-line bg-paper text-ink-2"
            }`}
          >
            {r.label}
          </button>
        ))}
        <Button type="button" variant="secondary" size={compactOwner ? "md" : "sm"} aria-pressed={coverageOnly}
          onClick={() => { setCoverageOnly(value => !value); setManageId(null); setNotice(null); }}>
          Needs cover <span className="tabular-nums">{withoutCoach.length}</span>
        </Button>
      </div>

      {notice ? <p role="status" className="mt-3 rounded-ctl border border-line bg-paper px-3 py-2 text-[13px] text-ink">{notice}</p> : null}
      <section className="mt-4">
        <div className="px-1">
          <SectionHeading
            title="Upcoming sessions"
            trailing={<span aria-live="polite" aria-atomic="true" className="text-[13px] tabular-nums text-ink-3">{filtered.length} {filtered.length === 1 ? "session" : "sessions"}</span>}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={coverageOnly ? "No sessions need cover in this window" : "Nothing in this window"}
              body={coverageOnly ? undefined : "Choose a wider date range to see more upcoming sessions."}
              action={coverageOnly ? { label:"Show all sessions", onClick: () => setCoverageOnly(false) } : { label: compactOwner ? "Show full window" : "Show all 14 days", onClick: () => selectRange("all") }}
            />
          </div>
        ) : (
          <>
            <div className="mt-3 space-y-4">
              {Array.from(grouped.entries()).map(([date, rows]) => (
                <div key={date}>
                  <h3 className="px-1 py-2 font-display text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3">
                    {formatWeekdayDateIST(date)}
                  </h3>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {rows.map((s) => {
                      const open = manageId === s.id;
                      const tone = SESSION_STATUS_TONE[s.status] ?? "neutral";
                      return (
                        <li key={s.id}>
                          <article aria-label={`${s.batchName} at ${s.locationName ?? "No location"}`} className="rounded-card border border-line bg-paper p-4" data-testid={`session-${s.id}`}>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                              <div className="min-w-0 w-full">
                                <p className="text-[14px] font-medium text-ink">
                                  <span className="owner-planner-time owner-session-range inline-flex w-fit">
                                    {formatTimeIST(s.startsAt)}&ndash;{formatTimeIST(s.endsAt)}
                                  </span>
                                  <span className="mt-0.5 block text-[12.5px] font-normal text-ink-2 md:mt-0 md:ml-2 md:inline">
                                    {s.batchName}
                                  </span>
                                </p>
                                <p className="mt-0.5 text-[12px] text-ink-3">Location: {s.locationName ?? "No location"}</p>
                                <p className="mt-0.5 text-[12px] text-ink-3">
                                  Coach:{" "}
                                  <span className="text-ink-2">
                                    {s.coachName ?? "Unassigned"}
                                  </span>
                                </p>
                              </div>
                              <StatusBadge tone={tone}>{statusLabel(s.status)}</StatusBadge>
                              {canManage ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setManageId(open ? null : s.id); setNotice(null); }}
                                  aria-expanded={open}
                                  aria-controls={open ? `session-editor-${s.id}` : undefined}
                                  data-testid={`manage-session-${s.id}`}
                                >
                                  {open ? "Close" : "Manage"}
                                </Button>
                              ) : null}
                            </div>

                            {open && canManage ? (
                              <section
                                id={`session-editor-${s.id}`}
                                aria-labelledby={`session-editor-label-${s.id}`}
                                className="mt-3 border-t border-line pt-3"
                                data-testid="selected-session"
                              >
                                <h4 id={`session-editor-label-${s.id}`} className="text-[14px] font-semibold text-ink">
                                  Manage {s.batchName}
                                </h4>
                                <p className="mt-1 text-[12px] text-ink-3">
                                  {formatWeekdayDateIST(s.sessionDate)} · {s.locationName ?? "No location"}
                                </p>
                                <div className="mt-2 grid min-w-0 gap-2">
                                  <SessionSubstituteControl
                                    sessionId={s.id}
                                    sessionDate={s.sessionDate}
                                    startsAt={formatTimeIST(s.startsAt)}
                                    endsAt={formatTimeIST(s.endsAt)}
                                    currentCoachName={s.coachName}
                                    coaches={coaches}
                                    onSubstituted={(result) => onSubstituted(s.id, result.newCoachName)}
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
                              </section>
                            ) : null}
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

    </div>
  );
}
