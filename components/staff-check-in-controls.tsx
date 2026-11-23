"use client";

import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  getMyAttendanceAction,
  selfCheckInAction,
  selfCheckOutAction,
} from "@/lib/actions/staff-attendance";
import type { MyAttendanceRow } from "@/lib/services/staff-attendance";
import { formatTimeIST } from "@/lib/time/tz";

// V-24 — the staff member's own check-in/out buttons on the Me tab.
// Both calls ride staff.self and the service resolves the caller's own
// staff row; there is no way to act on someone else from here.

export function StaffCheckInControls({
  initialAttendance,
  date,
}: {
  initialAttendance: MyAttendanceRow | null;
  date: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const summary = useRef<HTMLParagraphElement>(null);
  const focusCompletion = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [recovered, setRecovered] = useState<{
    date: string;
    initial: MyAttendanceRow | null;
    latest: MyAttendanceRow | null;
  } | null>(null);
  const attendance = recovered && recovered.date === date && recovered.initial === initialAttendance
    ? recovered.latest
    : initialAttendance;
  const checkedIn = Boolean(attendance?.checkedInAt);
  const checkedOut = Boolean(attendance?.checkedOutAt);

  useEffect(() => {
    if (checkedOut && focusCompletion.current && document.activeElement === document.body) {
      summary.current?.focus();
    }
  }, [checkedOut]);

  function run(event: MouseEvent<HTMLButtonElement>) {
    if (pending) return;
    focusCompletion.current = document.activeElement === event.currentTarget;
    startTransition(async () => {
      try {
        if (needsCheck) {
          const latest = await getMyAttendanceAction({ date });
          setRecovered({ date, initial: initialAttendance, latest });
          setNeedsCheck(false);
          setError(null);
          return;
        }
        const result = checkedIn ? await selfCheckOutAction() : await selfCheckInAction({ method: "self_app" });
        setError(result.ok ? null : result.error);
        if (result.ok) router.refresh();
      } catch {
        setNeedsCheck(true);
        setError(needsCheck
          ? "Could not check attendance. Reconnect and try the check again."
          : "The connection was interrupted. Check your attendance before trying again.");
      }
    });
  }

  const label = needsCheck ? "Check attendance" : checkedIn ? "Check out" : "Check in";
  return (
    <div className="mt-2">
      <p ref={summary} role="status" tabIndex={-1} className="text-[13px] text-ink-2">
        {needsCheck ? "Checking is needed to confirm your attendance." : attendanceSummary(attendance)}
      </p>
      <div className="mt-3">
        {needsCheck || !checkedOut ? (
          <Button variant="primary" size="md" aria-disabled={pending} className="aria-disabled:opacity-50" onClick={run}>
            {pending ? needsCheck ? "Checking…" : "Saving…" : label}
          </Button>
        ) : (
          <p className="text-[13px] text-ink-3">Done for today.</p>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function attendanceSummary(attendance: MyAttendanceRow | null): string {
  if (!attendance) return "Not checked in yet.";
  if (!attendance.checkedInAt) return attendance.note ?? `Marked ${attendance.status.replace("_", " ")} for today.`;
  const late = attendance.lateMinutes > 0 ? ` · ${attendance.lateMinutes} min late` : "";
  const out = attendance.checkedOutAt ? ` · out ${formatTimeIST(attendance.checkedOutAt)}` : "";
  return `Checked in ${formatTimeIST(attendance.checkedInAt)}${late}${out}`;
}
