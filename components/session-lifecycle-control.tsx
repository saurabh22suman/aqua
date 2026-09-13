"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock } from "lucide-react";
import {
  cancelSessionAction,
  rescheduleSessionAction,
} from "@/lib/actions/session-lifecycle";
import { zonedWallTimeToInstant } from "@/lib/time/tz";

// R.4 (docs/five-day-work-guide.md) — per-session cancel/reschedule
// controls for /owner/sessions. The service (cancelSession,
// rescheduleSession) and actions shipped earlier; this is the surface.
// Rescheduling preserves the session id, so offline clientId-keyed
// marks still map to the same session; the F2 coach-conflict guard
// surfaces inline.
export function SessionLifecycleControl({
  sessionId,
  sessionDate,
  startWall,
  endWall,
  status,
  onChanged,
}: {
  sessionId: string;
  sessionDate: string;
  startWall: string;
  endWall: string;
  status: string;
  onChanged: (next: {
    status: string;
    sessionDate: string;
    startsAt?: string;
    endsAt?: string;
  }) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "reschedule" | "confirmCancel">("idle");
  const [date, setDate] = useState(sessionDate);
  const [start, setStart] = useState(startWall);
  const [end, setEnd] = useState(endWall);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    fn: () => Promise<
      | { kind: "ok"; newStatus: string; newSessionDate: string }
      | { kind: "error"; message: string }
    >,
    times?: { startsAt: string; endsAt: string },
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.kind === "error") {
        setError(res.message);
        return;
      }
      setMode("idle");
      onChanged({
        status: res.newStatus,
        sessionDate: res.newSessionDate,
        ...(times ?? {}),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    void run(() => cancelSessionAction({ sessionId }));
  }

  function reschedule() {
    const startsAt = zonedWallTimeToInstant(date, start, "Asia/Kolkata");
    const endsAt = zonedWallTimeToInstant(date, end, "Asia/Kolkata");
    void run(
      () =>
        rescheduleSessionAction({
          sessionId,
          newSessionDate: date,
          newStartsAt: startsAt.toISOString(),
          newEndsAt: endsAt.toISOString(),
        }),
      { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    );
  }

  if (mode === "reschedule") {
    return (
      <div className="mt-2 space-y-2 rounded-ctl border border-line bg-deck p-3">
        <div>
          <label className="block text-[11.5px] text-ink-3 mb-1">
            New date
          </label>
          <input
            type="date"
            lang="en-IN"
            placeholder="dd/mm/yyyy"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px]"
            data-testid="reschedule-date"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="min-w-0 flex-1 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px]"
            aria-label="Start time"
            data-testid="reschedule-start"
          />
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="min-w-0 flex-1 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px]"
            aria-label="End time"
            data-testid="reschedule-end"
          />
        </div>
        {error ? (
          <p className="flex items-start gap-2 text-[11.5px] text-ink-2" role="alert">
            <AlertTriangle size={13} className="text-ink-2 flex-none mt-0.5" />
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reschedule}
            disabled={busy || !date || end <= start}
            className="flex-1 rounded-ctl bg-[var(--accent)] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save new time"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setError(null);
            }}
            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[13px] text-ink-3"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (mode === "confirmCancel") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-ctl border border-line bg-deck p-3">
        <p className="min-w-0 flex-1 text-[12px] text-ink-2">
          Cancel this session? The register keeps any marks already
          recorded.
        </p>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="flex-none rounded-ctl border border-line bg-paper px-3 min-h-[44px] text-[12.5px] font-medium text-ink-2 disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setMode("idle")}
          className="flex-none rounded-ctl px-2 min-h-[44px] text-[12.5px] text-ink-3"
        >
          Keep
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {status === "cancelled" ? (
        <span className="rounded-pill bg-deck px-2.5 py-1 text-[11px] font-medium text-ink-3">
          Cancelled
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setMode("confirmCancel")}
          className="rounded-ctl border border-line bg-deck px-3 min-h-[44px] text-[12px] font-medium text-ink-2"
          data-testid={`cancel-open-${sessionId}`}
        >
          Cancel session
        </button>
      )}
      <button
        type="button"
        onClick={() => setMode("reschedule")}
        className="inline-flex items-center gap-1 rounded-ctl border border-line bg-deck px-3 min-h-[44px] text-[12px] font-medium text-ink-2"
        data-testid={`reschedule-open-${sessionId}`}
      >
        <CalendarClock size={13} aria-hidden="true" />
        Reschedule
      </button>
    </div>
  );
}
