"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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

  const totalCheckedIn = sessions.reduce((n, s) => n + s.marked, 0);

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
        <h2 className="font-display text-[14px] font-semibold">
          Today&apos;s check-ins
        </h2>
        {sessions.length > 0 ? (
          <span className="text-[12px] text-ink-3">
            {totalCheckedIn} checked in
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
            const pct = s.total > 0 ? Math.round((s.marked / s.total) * 100) : 0;
            const fill =
              s.marked === 0 ? "bg-water" : pct < 50 ? "bg-warn" : "bg-good";
            const rows = roster[s.id];
            return (
              <li key={s.id}>
                <div className="bg-paper rounded-card border border-line">
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-expanded={open}
                    data-testid={`checkin-session-${s.id}`}
                    className="w-full min-h-[56px] px-4 py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[15px] font-display font-semibold">
                        {formatTimeIST(s.startsAt)} {s.batchName}
                      </span>
                      <span className="flex items-center gap-1 text-[13px] text-ink-3 flex-none">
                        {s.total === 0
                          ? "No one enrolled"
                          : `${s.marked} / ${s.total} checked in`}
                        {open ? (
                          <ChevronUp size={16} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={16} aria-hidden="true" />
                        )}
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
