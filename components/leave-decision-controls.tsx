"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  approveLeaveRequestAction,
  listUncoveredSessionsAction,
  rejectLeaveRequestAction,
} from "@/lib/actions/leave";
import type { UncoveredSessionRow } from "@/lib/services/leave";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";

// V-27 — the decision controls on a pending request. Review loads the
// sessions this staff member coaches inside the leave range BEFORE
// approving, so the owner sees the cover gap while there is still time
// to arrange a substitute. The decision records who and why (the note
// is optional here but carried into the audit row and the staff view).

export function LeaveDecisionControls({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<UncoveredSessionRow[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function review() {
    setOpen(true);
    setError(null);
    if (sessions !== null) return;
    startTransition(async () => {
      setSessions(await listUncoveredSessionsAction({ requestId }));
    });
  }

  function decide(kind: "approved" | "rejected") {
    startTransition(async () => {
      const result =
        kind === "approved"
          ? await approveLeaveRequestAction({
              requestId,
              note: note.trim() === "" ? null : note.trim(),
            })
          : await rejectLeaveRequestAction({
              requestId,
              note: note.trim() === "" ? null : note.trim(),
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" disabled={pending} onClick={review}>
        Review
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-ctl border border-line bg-deck/50 p-3">
      <p className="text-[12.5px] font-medium">Sessions left uncovered</p>
      {sessions === null ? (
        <p className="mt-1 text-[12.5px] text-ink-3">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-ink-3">
          None — no sessions this coach leads in the range.
        </p>
      ) : (
        <ul className="mt-1.5 divide-y divide-line">
          {sessions.map((session) => (
            <li key={session.sessionId} className="py-2 text-[12.5px]">
              <span className="font-medium">{session.batchName}</span>
              <span className="text-ink-3">
                {" "}
                · {formatDateIST(`${session.sessionDate}T12:00:00Z`)} ·{" "}
                {formatTimeIST(session.startsAt)}–
                {formatTimeIST(session.endsAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <label className="mt-2 block">
        <span className="mb-1 block text-[11px] text-ink-3">
          Note (shown to the staff member)
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
        />
      </label>

      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => decide("approved")}
        >
          Approve
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => decide("rejected")}
        >
          Reject
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
