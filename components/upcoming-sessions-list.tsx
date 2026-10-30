"use client";

import { useMemo, useState } from "react";
import { SessionSubstituteControl } from "@/components/session-substitute-control";
import { SessionLifecycleControl } from "@/components/session-lifecycle-control";
import type { UpcomingSessionRow } from "@/lib/services/coach-schedule";
import type { CoachOption } from "@/lib/services/programs";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import {
  addDays,
  formatDateIST,
  formatTimeIST,
  formatWallTime24hIST,
  formatWeekdayDateIST,
  todayInZone,
} from "@/lib/time/tz";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { StatusBadge, SESSION_STATUS_TONE } from "@/components/ui/StatusBadge";
import { SectionHeading } from "@/components/ui/PageHeader";

// F3 (R.1) — client island for /owner/sessions.
//
// Owner OpenPen (29 October 2026): the 14-day window is a management
// table, not a wall of cards. Each row states its lifecycle, and one
// Manage selects the session into a bounded editor below the list —
// substitution, cancellation and rescheduling stay contextual and the
// register still records who actually ran the session.
//
// 2026-09-13 UI/UX audit §11 #5: the default window is "today" when
// there is anything today (else the coming week, else the full window),
// and a row's exception actions live behind one Manage control.

type RangeKey = "today" | "week" | "all";

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

function formatHeaderDate(dateStr: string): string {
  return formatWeekdayDateIST(dateStr);
}

export function UpcomingSessionsList({
  initialSessions,
  coaches,
  terminology,
  timezone = "Asia/Kolkata",
  canManage,
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
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [manageId, setManageId] = useState<string | null>(null);

  const today = todayInZone(timezone);
  const weekEnd = addDays(today, 6);

  // Initial choice only — the user owns the control after mount.
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
      <section className="rounded-card border border-line bg-paper p-5">
        <EmptyState
          title="No upcoming sessions"
          body="Sessions are generated four weeks ahead from each batch's schedule. Add a batch in the programs board if none exist yet."
        />
      </section>
    );
  }

  const grouped = groupByDate(filtered);
  const selected = sessions.find((row) => row.id === manageId) ?? null;
  const RANGES: { key: RangeKey; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "Next 7 days" },
    { key: "all", label: "All 14 days" },
  ];

  return (
    <div>
      <div
        role="group"
        aria-label="Session window"
        className="flex flex-wrap gap-2"
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
                ? "border-[var(--accent-strong)] bg-[var(--control-surface-action)] text-[var(--accent-ink)]"
                : "border-line bg-paper text-ink-2"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <section className="mt-4 rounded-card border border-line bg-paper">
        <div className="px-5 pt-5">
          <SectionHeading
            title="Sessions needing management"
            subtitle="Today and the next 14 days. Manage one session at a time."
          />
        </div>

        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Nothing in this window"
              body="No sessions fall in the selected window. Show the full 14 days to see everything scheduled."
              action={{ label: "Show all 14 days", onClick: () => setRange("all") }}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-y border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-3">
                    <th scope="col" className="px-5 py-2.5 font-medium">{titleCase(resolveTerm(terminology, "session", 1))}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{titleCase(resolveTerm(terminology, "coach", 1))}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">State</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((s) => {
                    const open = manageId === s.id;
                    const tone = SESSION_STATUS_TONE[s.status] ?? "neutral";
                    return (
                      <tr key={s.id}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink">
                            {formatDateIST(s.sessionDate)} ·{" "}
                            <span className="whitespace-nowrap tabular-nums">
                              {formatTimeIST(s.startsAt)}–{formatTimeIST(s.endsAt)}
                            </span>
                          </p>
                          <p className="mt-0.5 text-[12px] text-ink-3">{s.batchName}</p>
                        </td>
                        <td className="px-3 py-3 text-ink-2">
                          {s.coachName ?? "Unassigned"}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={tone}>{statusLabel(s.status)}</StatusBadge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canManage ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setManageId(open ? null : s.id)}
                              aria-expanded={open}
                            >
                              {open ? "Close" : "Manage"}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden">
              {Array.from(grouped.entries()).map(([date, rows]) => (
                <div key={date}>
                  <h3 className="border-y border-line bg-deck/60 px-5 py-2 font-display text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3">
                    {formatHeaderDate(date)}
                  </h3>
                  <ul className="divide-y divide-line">
                    {rows.map((s) => {
                      const open = manageId === s.id;
                      const tone = SESSION_STATUS_TONE[s.status] ?? "neutral";
                      return (
                        <li key={s.id} className="px-5 py-3" data-testid={`session-${s.id}`}>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-medium text-ink">
                                <span className="whitespace-nowrap">
                                  {formatTimeIST(s.startsAt)}&ndash;{formatTimeIST(s.endsAt)}
                                </span>
                                <span className="mt-0.5 block text-[12.5px] font-normal text-ink-2 md:mt-0 md:ml-2 md:inline">
                                  {s.batchName}
                                </span>
                              </p>
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
                                variant="secondary"
                                size="sm"
                                onClick={() => setManageId(open ? null : s.id)}
                                aria-expanded={open}
                                data-testid={`manage-session-${s.id}`}
                              >
                                {open ? "Close" : "Manage"}
                              </Button>
                            ) : null}
                          </div>
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

      {selected ? (
        <section
          className="mt-5 rounded-card border border-line bg-paper p-5"
          data-testid="selected-session"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-[16px] font-semibold">
                Selected session · {selected.batchName}
              </h2>
              <p className="mt-1 text-[12.5px] text-ink-3">
                {formatWeekdayDateIST(selected.sessionDate)} ·{" "}
                {formatTimeIST(selected.startsAt)}–{formatTimeIST(selected.endsAt)} ·{" "}
                {selected.coachName ?? "Unassigned"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setManageId(null)}>
              Close
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <SessionSubstituteControl
              sessionId={selected.id}
              sessionDate={selected.sessionDate}
              startsAt={formatTimeIST(selected.startsAt)}
              endsAt={formatTimeIST(selected.endsAt)}
              currentCoachName={selected.coachName}
              coaches={coaches}
              onSubstituted={(result) => {
                onSubstituted(selected.id, result.newCoachName);
              }}
              terminology={terminology}
            />
            <SessionLifecycleControl
              sessionId={selected.id}
              sessionDate={selected.sessionDate}
              startWall={formatWallTime24hIST(selected.startsAt)}
              endWall={formatWallTime24hIST(selected.endsAt)}
              status={selected.status}
              onChanged={(next) => onLifecycleChanged(selected.id, next)}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
