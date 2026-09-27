"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctStaffAttendanceAction } from "@/lib/actions/staff-attendance";
import { Button } from "@/components/ui/Button";
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
}: {
  date: string;
  rows: StaffAttendanceDayRow[];
  canMark: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<"present" | "absent">("present");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function open(staffId: string, nextStatus: "present" | "absent") {
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

      {rows.length === 0 ? (
        <p className="mt-3 rounded-card border border-line bg-paper px-4 py-6 text-center text-[13px] text-ink-3">
          No staff records yet. Add staff from the owner surface.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-paper">
          {rows.map((row) => {
            const late = row.lateMinutes > 0;
            return (
              <li key={row.staffId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">
                      {row.staffName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      {row.staffType}
                      {row.shiftStartAt && row.shiftEndAt
                        ? ` · shift ${formatTimeIST(row.shiftStartAt)}–${formatTimeIST(row.shiftEndAt)}`
                        : " · no shift today"}
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
                  ) : (
                    <StatusBadge tone="neutral">Not marked</StatusBadge>
                  )}
                </div>

                {row.note ? (
                  <p className="mt-1.5 text-[12px] text-ink-2">
                    Reason: {row.note}
                  </p>
                ) : null}

                {canMark ? (
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
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="Reason (required)"
                        className="mt-2 w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink"
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
                    <div className="mt-2 flex gap-2">
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
