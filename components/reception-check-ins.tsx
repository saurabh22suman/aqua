"use client";

import { useState } from "react";
import {
  getRosterAction,
  markAttendanceSessionAction,
  type RosterRow,
  type TodaySession,
} from "@/lib/actions/coach";
import { PersonAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, ATTENDANCE_MARK_TONE } from "@/components/ui/StatusBadge";
import { SkeletonLine } from "@/components/skeleton";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatTimeIST } from "@/lib/time/tz";

// U-08 — reception's "Today's check-ins" panel. Built only from the
// existing sessions + attendance schema through the existing actions
// (getTodayAction feeds `sessions`, getRosterAction loads a register,
// markAttendanceSessionAction writes the mark). Reception carries
// `attendance.mark` (lib/services/roles.ts), so `canMark` is true for
// the receptionist role and the panel is interactive; a role without
// the permission still sees the day's state read-only.
//
// One tap marks `present`. There is no staff-attendance section here:
// that needs V-24's shifts schema and is deferred.

const MARK_LABELS: Record<string, string> = {
  present: "Here",
  late: "Late",
  absent: "Absent",
};

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `checkin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ReceptionCheckIns({
  sessions,
  canMark,
}: {
  sessions: TodaySession[];
  canMark: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Record<string, RosterRow[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // The server's marked count includes absent marks: it is register
  // completion, not a count of people present. Once loaded, the roster
  // provides the current count, including confirmed local updates.
  const markedFor = (session: TodaySession) =>
    roster[session.id]?.filter((row) => row.status !== null).length ?? session.marked;
  const totalMarked = sessions.reduce((n, s) => n + markedFor(s), 0);

  async function toggle(sessionId: string) {
    setMarkError(null);
    if (openId === sessionId) {
      setOpenId(null);
      return;
    }
    setOpenId(sessionId);
    if (roster[sessionId]) return;
    setLoadingId(sessionId);
    setLoadError(null);
    try {
      const data = await getRosterAction(sessionId);
      if (!data) {
        setLoadError("That session's register is not available.");
        return;
      }
      setRoster((prev) => ({ ...prev, [sessionId]: data.rows }));
    } catch {
      setLoadError("Could not load the register.");
    } finally {
      setLoadingId(null);
    }
  }

  async function checkIn(sessionId: string, memberId: string) {
    setMarkError(null);
    setMarkingId(memberId);
    try {
      const result = await markAttendanceSessionAction({
        sessionId,
        memberId,
        status: "present",
        clientId: newClientId(),
      });
      if (!result.ok) {
        setMarkError(result.error ?? "Could not check in.");
        return;
      }
      setRoster((prev) => ({
        ...prev,
        [sessionId]: (prev[sessionId] ?? []).map((row) =>
          row.memberId === memberId
            ? { ...row, status: "present", markedAt: new Date().toISOString() }
            : row,
        ),
      }));
    } catch {
      setMarkError("Could not check in. Try again.");
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <section className="mt-6" data-testid="reception-checkins">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
          <OwnerIcon name="calendar" size={16} className="text-ink-3" />
          Today&apos;s check-ins
        </h2>
        {sessions.length > 0 ? (
          <span className="text-[12px] text-ink-3">
            {totalMarked} marked
          </span>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No sessions today"
            body="Check-ins appear here once today's sessions start."
          />
        </div>
      ) : (
        <ul className="mt-3 space-y-4">
          {sessions.map((s) => {
            const open = openId === s.id;
            const marked = markedFor(s);
            const pct = s.total > 0 ? Math.round((marked / s.total) * 100) : 0;
            const fill =
              marked === 0 ? "bg-water" : pct < 50 ? "bg-warn" : "bg-good";
            const rows = roster[s.id];
            return (
              <li key={s.id}>
                <div className="rounded-2xl border border-line bg-paper">
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-expanded={open}
                    data-testid={`checkin-session-${s.id}`}
                    className="w-full min-h-[56px] px-4 py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[15px] font-medium leading-snug text-ink">
                        {formatTimeIST(s.startsAt)} {s.batchName}
                        {s.locationName ? <span className="block text-[12px] font-normal text-ink-3">{s.locationName}</span> : null}
                      </span>
                      <span className="flex flex-none items-center gap-1 text-[13px] text-ink-3">
                        {s.total === 0
                          ? "No one enrolled"
                          : `${marked} / ${s.total} marked`}
                        <OwnerIcon
                          name="down"
                          size={16}
                          className={open ? "rotate-180" : undefined}
                        />
                      </span>
                    </div>
                    {s.total > 0 ? (
                      <div className="mt-2 h-1.5 rounded-pill bg-deck overflow-hidden">
                        <div
                          className={`h-full rounded-pill ${fill}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    ) : null}
                  </button>

                  {open ? (
                    <div className="border-t border-line px-4 py-2">
                      {loadingId === s.id ? (
                        <div className="py-2" data-testid="checkin-loading">
                          <SkeletonLine count={3} width={40} />
                        </div>
                      ) : loadError ? (
                        <p role="alert" className="py-3 text-[13px] text-ink-2">
                          {loadError}
                        </p>
                      ) : rows && rows.length === 0 ? (
                        <p className="py-3 text-[13px] text-ink-3">
                          No one is enrolled yet.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {(rows ?? []).map((row) => (
                            <li
                              key={row.memberId}
                              className="flex min-h-[44px] items-center gap-3 py-2"
                            >
                              <PersonAvatar
                                name={row.name}
                                seed={row.memberId}
                                size={32}
                                className="flex-none"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[14px] font-medium truncate">
                                  {row.name}
                                </p>
                                <p className="mt-0.5 text-[12px] text-ink-3 truncate">
                                  {row.code}
                                </p>
                              </div>
                              {row.status ? (
                                <StatusBadge
                                  tone={ATTENDANCE_MARK_TONE[row.status] ?? "neutral"}
                                >
                                  {MARK_LABELS[row.status] ?? row.status}
                                  {row.markedAt && row.status !== "absent"
                                    ? ` · ${formatTimeIST(row.markedAt)}`
                                    : ""}
                                </StatusBadge>
                              ) : canMark ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={markingId === row.memberId}
                                  onClick={() => checkIn(s.id, row.memberId)}
                                  aria-label={`Check in ${row.name}`}
                                >
                                  {markingId === row.memberId
                                    ? "Checking in…"
                                    : "Check in"}
                                </Button>
                              ) : (
                                <span className="text-[12px] text-ink-3">
                                  Not checked in
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {markError ? (
                        <p role="alert" className="pb-2 text-[12px] text-ink-2">
                          {markError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
