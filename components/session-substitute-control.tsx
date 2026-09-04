"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { substituteCoachAction } from "@/lib/actions/coach-substitution";
import type { CoachOption } from "@/lib/services/programs";

// F3 (R.1) — substitution surface. Rendered once per upcoming
// session on /owner/sessions. The current coach's name is shown
// for context; tapping "Substitute" reveals a coach picker that
// calls substituteCoachAction on submit. The F2 conflict guard
// (detectSessionConflicts) rejects the substitution at the
// service layer when the proposed coach already has another
// session in this window — that error surfaces here as an inline
// message.

export function SessionSubstituteControl({
  sessionId,
  sessionDate,
  startsAt,
  endsAt,
  currentCoachName,
  coaches,
  onSubstituted,
}: {
  sessionId: string;
  sessionDate: string;
  startsAt: string;
  endsAt: string;
  currentCoachName: string | null;
  coaches: CoachOption[];
  onSubstituted: (result: { newCoachId: string; newCoachName: string }) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflictingSessionIds, setConflictingSessionIds] = useState<string[]>([]);

  async function submit() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    setConflictingSessionIds([]);
    try {
      const res = await substituteCoachAction({
        sessionId,
        newCoachId: picked,
      });
      if (res.kind === "ok") {
        const newName =
          coaches.find((c) => c.staffId === res.newCoachId)?.fullName ?? "Substituted";
        setOpen(false);
        setPicked("");
        onSubstituted({ newCoachId: res.newCoachId, newCoachName: newName });
        router.refresh();
        return;
      }
      if (res.code === "coach_conflict") {
        setError(
          "This coach already has another session in this time window. Pick another coach or reschedule the other session first.",
        );
        setConflictingSessionIds(res.conflictingSessionIds ?? []);
      } else if (res.code === "coach_not_found") {
        setError("That coach no longer exists in this tenant.");
      } else if (res.code === "invalid") {
        setError("Pick a coach to substitute in.");
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-ctl border border-line bg-deck px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-paper"
        data-testid={`substitute-open-${sessionId}`}
      >
        Substitute
      </button>
    );
  }

  const eligibleCoaches = coaches.filter((c) => c.fullName !== currentCoachName);

  return (
    <div className="mt-2 space-y-2 rounded-ctl border border-line bg-deck p-3">
      <p className="text-[11.5px] text-ink-3">
        Substitute for {sessionDate}, {startsAt}–{endsAt}
      </p>
      <select
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px]"
        data-testid={`substitute-coach-${sessionId}`}
      >
        <option value="">Choose coach…</option>
        {eligibleCoaches.map((c) => (
          <option key={c.staffId} value={c.staffId}>
            {c.fullName}
          </option>
        ))}
      </select>
      {error ? (
        <div className="flex items-start gap-2 rounded-ctl bg-warn-soft px-3 py-2" role="alert">
          <AlertTriangle size={14} className="text-warn flex-none mt-0.5" />
          <p className="text-[11.5px] text-ink-2">
            <span className="font-medium">{error}</span>
            {conflictingSessionIds.length > 0
              ? ` Conflicts: ${conflictingSessionIds.join(", ")}.`
              : ""}
          </p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !picked}
          className="flex-1 rounded-ctl bg-[var(--accent)] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          data-testid={`substitute-submit-${sessionId}`}
        >
          {busy ? "Saving…" : "Confirm substitution"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPicked("");
            setError(null);
          }}
          className="rounded-ctl border border-line bg-paper px-3 py-2 text-[13px] text-ink-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SubstitutedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-water-soft px-2 py-0.5 text-[11px] font-medium text-water">
      <Check size={11} />
      Substituted
    </span>
  );
}
