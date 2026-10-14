"use client";

import { useState, useTransition } from "react";
import { setStaffCurriculumLeadAction } from "@/lib/actions/curriculum-lead";
import type { CurriculumLeadState } from "@/lib/services/curriculum-lead";

// R02 (2026-10-13 role-workflow audit) — owner/admin designation of a
// single curriculum lead. The confirmation states the restored role
// and location scope before anything changes; the server action
// re-checks settings.manage and the target's eligibility.

export function CurriculumLeadControl({
  staffId,
  fullName,
  state,
}: {
  staffId: string;
  fullName: string;
  state: CurriculumLeadState;
}) {
  const [isLead, setIsLead] = useState(state.isLead);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setStaffCurriculumLeadAction({ staffId, enabled: next });
      if (result.kind === "error") {
        setError(result.message);
        return;
      }
      setIsLead(result.isLead);
      setConfirming(false);
    });
  }

  const scope =
    state.locationNames.length > 0
      ? state.locationNames.join(", ")
      : "All locations in this academy";

  return (
    <section
      className="mt-5 bg-paper border border-line rounded-card p-4"
      data-testid="curriculum-lead-control"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold">Curriculum lead</h2>
          <p className="mt-1 text-[12.5px] text-ink-3 leading-snug">
            {isLead
              ? `${fullName} can edit the academy-wide skill framework and rubrics.`
              : "Delegate the academy-wide skill framework and rubrics to this coach."}
          </p>
        </div>
        <span className="flex-none rounded-pill bg-deck px-3 py-1 text-[12px] font-medium text-ink-2">
          {isLead ? "Curriculum lead" : "Ordinary coach"}
        </span>
      </div>

      {!state.eligible ? (
        <p className="mt-3 text-[12.5px] text-ink-3">{state.reason}</p>
      ) : confirming ? (
        <div className="mt-3 rounded-ctl border border-line bg-deck/40 px-3 py-3">
          <p className="text-[13px] font-medium">
            {isLead ? "Remove curriculum-lead access?" : "Make curriculum lead?"}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-3 leading-snug">
            {isLead
              ? `${fullName} returns to the ordinary coach role: assigned register, assessments and own self-service only.`
              : `${fullName} keeps coach access and gains academy-wide curriculum editing (${scope}). The change is audited.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => submit(!isLead)}
              className="min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
            >
              {pending ? "Saving…" : isLead ? "Remove access" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="min-h-[44px] rounded-pill bg-deck px-5 text-[13px] font-semibold text-ink-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 min-h-[44px] rounded-pill bg-deck px-5 text-[13px] font-semibold text-ink-2"
        >
          {isLead ? "Remove curriculum-lead access" : "Make curriculum lead"}
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}
    </section>
  );
}
