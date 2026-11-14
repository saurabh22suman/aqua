"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctStaffAttendanceAction } from "@/lib/actions/staff-attendance";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatTimeIST } from "@/lib/time/tz";
import type { StaffAttendanceDayRow } from "@/lib/services/staff-attendance";

// V-24 — the reception desk's "Staff attendance" board. The deferred
// U-08 half: reception already marks member attendance; this marks the
// people who run the academy.
//
// Every mark here is a manual correction and the service requires a
// reason, so tapping Present/Absent opens an inline reason panel
// before the write. The audit row carries the caller (marked_by) and
// the note — the V-24 done-when. A role without staff.attendance gets
// the read-only list.
//
// Facility-scoped manager (the r3 read): a null status can mean either
// "no record" or "a record whose shift cannot be proved at a facility I
// may see". The two must look identical, or the board discloses that an
// out-of-scope record exists. They render as a neutral "Unknown" and
// do not offer a correction the server will refuse.

const STATUS_TONE: Record<string, StatusTone> = {
  present: "good",
  half_day: "warn",
  absent: "late",
  leave: "water",
  holiday: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  leave: "Leave",
  holiday: "Holiday",
};

const QUICK_REASONS = [
  "No login yet",
  "Forgot to check in",
  "Phone not with them",
];

export function StaffAttendanceBoard({
  date,
  rows,
  canMark,
  canCreateMissing = true,
  showExtendedStatuses = false,
}: {
  date: string;
  rows: StaffAttendanceDayRow[];
  canMark: boolean;
  canCreateMissing?: boolean;
  showExtendedStatuses?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<"present" | "absent" | "half_day" | "leave" | "holiday">("present");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Board-level, never per-row: "limited" means the read applied the
  // facility-proof filter. Every null status on such a board is Unknown.
  const hasLimitedRows = rows.some(
    (row) => row.attendanceVisibility === "limited",
  );

  function open(staffId: string, nextStatus: "present" | "absent" | "half_day" | "leave" | "holiday") {
    setEditingId(staffId);
    setStatus(nextStatus);
    setNote("");
    setError(null);
  }

  function submit(staffId: string) {
    startTransition(async () => {
      const result = await correctStaffAttendanceAction({
        staffId,
        workDate: date,
        status,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  return (
    <section className="mt-8" data-testid="staff-attendance">
      <h2 className="font-display text-[15px] font-semibold">Staff attendance</h2>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Marking for someone else records your name and the reason.
      </p>
      {hasLimitedRows ? (
        <p className="mt-1 text-[12.5px] text-ink-3">
          Unknown means attendance is not confirmed. It is not a mark of
          absence.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-3 rounded-card border border-line bg-paper px-4 py-6 text-center text-[13px] text-ink-3">
          No staff records yet. Add staff from the owner surface.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-paper">
          {rows.map((row) => {
            const late = row.lateMinutes > 0;
            const limited = row.attendanceVisibility === "limited";
            // A visible status proves the record is at a facility this
            // caller may see, so the existing correction path can reach
            // it. A null limited row is unknown and the service refuses:
            // no new facility-scoped record, no unprovable/out-of-scope
            // record. Do not offer an action that can only fail.
            const canCorrectThisRow =
              canMark && (row.status !== null || (!limited && canCreateMissing));
            let shiftText = limited ? " · no shift shown" : " · no shift today";
            if (row.shiftStartAt && row.shiftEndAt) {
              shiftText = ` · shift ${formatTimeIST(row.shiftStartAt)}–${formatTimeIST(row.shiftEndAt)}`;
            }

            return (
              <li key={row.staffId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">
                      {row.staffName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      {row.staffType}
                      {shiftText}
                      {row.checkedInAt
                        ? ` · in ${formatTimeIST(row.checkedInAt)}`
                        : ""}
                      {row.checkedOutAt
                        ? ` · out ${formatTimeIST(row.checkedOutAt)}`
                        : ""}
                      {late ? ` · ${row.lateMinutes} min late` : ""}
                    </p>
                  </div>
                  {row.status ? (
                    <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </StatusBadge>
                  ) : limited ? (
                    <StatusBadge tone="neutral">Unknown</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Not marked</StatusBadge>
                  )}
                </div>

                {row.note ? (
                  <p className="mt-1.5 text-[12px] text-ink-2">
                    Reason: {row.note}
                  </p>
                ) : null}

                {canCorrectThisRow ? (
                  editingId === row.staffId ? (
                    <div className="mt-3 rounded-ctl border border-line bg-deck/50 p-3">
                      <p className="text-[12.5px] font-medium">
                        Mark {STATUS_LABEL[status].toLowerCase()} — why?
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {QUICK_REASONS.map((reason) => (
                          <button
                            key={reason}
                            type="button"
                            onClick={() => setNote(reason)}
                            className="min-h-11 rounded-pill border border-line bg-paper px-3 text-[12.5px] text-ink-2"
                          >
                            {reason}
                          </button>
                        ))}
                      </div>
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="Reason (required)"
                        aria-label="Reason (required)"
                        className="mt-2 w-full"
                      />
                      {error ? (
                        <p role="alert" className="mt-1 text-[12.5px] text-ink-2">
                          {error}
                        </p>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="primary"
                          disabled={pending || note.trim().length === 0}
                          onClick={() => submit(row.staffId)}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={pending}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={() => open(row.staffId, "present")}
                      >
                        Present
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={() => open(row.staffId, "absent")}
                      >
                        Absent
                      </Button>
                      {showExtendedStatuses ? (["half_day", "leave", "holiday"] as const).map((value) => (
                        <Button key={value} variant="secondary" disabled={pending} onClick={() => open(row.staffId, value)}>
                          {STATUS_LABEL[value]}
                        </Button>
                      )) : null}
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
