"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listBatchesAction } from "@/lib/actions/programs";
import { enrolMemberAction, listMemberEnrolmentsAction } from "@/lib/actions/enrolment";
import type { MemberEnrolment } from "@/lib/services/enrolment";
import type { BatchWithProgramName } from "@/lib/services/programs";

// B3 — a member created through reception's add-member form, or
// produced by converting an enquiry with no prior trial booking,
// previously had no visible way to reach a batch: enrolMember()
// existed but had exactly one reachable caller (bookTrial). This is
// the always-visible follow-up step, on the member detail page, that
// closes that gap for both paths.
//
// C2 — the two data fetches below used to have no error handling: a
// transient failure (confirmed live during QA — a dev-mode stale
// server-action artifact, but any transient failure has the same
// shape) left this section silently blank, indistinguishable from "no
// batches exist yet". Rule 1: fail loudly. `loadError` below is shown
// with a Retry action, never swallowed into an empty-looking panel.
//
// C3 — a member enrolled in one batch previously had no way to add a
// second: the panel only rendered the picker in the zero-enrolments
// branch. A swimmer in two batches is normal. The picker is now
// always shown (filtered to batches not already enrolled in), below
// the current-enrolments list when there is one.

export function MemberEnrolmentPanel({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [enrolments, setEnrolments] = useState<MemberEnrolment[] | null>(null);
  const [batches, setBatches] = useState<BatchWithProgramName[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoadError(null);
    setEnrolments(null);
    setBatches(null);
    try {
      const [enrolmentRows, batchRows] = await Promise.all([
        listMemberEnrolmentsAction(memberId),
        listBatchesAction(),
      ]);
      setEnrolments(enrolmentRows);
      setBatches(batchRows);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load enrolment data.",
      );
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const enrolledBatchIds = new Set((enrolments ?? []).map((e) => e.batchId));
  const availableBatches = (batches ?? []).filter((b) => !enrolledBatchIds.has(b.id));
  const effectiveBatchId = availableBatches.some((b) => b.id === selectedBatchId)
    ? selectedBatchId
    : (availableBatches[0]?.id ?? "");

  async function enrol() {
    if (!effectiveBatchId) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await enrolMemberAction({ memberId, batchId: effectiveBatchId });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setSelectedBatchId("");
      const rows = await listMemberEnrolmentsAction(memberId);
      setEnrolments(rows);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div
        className="mt-4 rounded-card border border-late bg-late-soft p-3.5"
        role="alert"
        data-testid="enrolment-load-error"
      >
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-late">
          Enrolment
        </h2>
        <p className="mt-2 text-[13px] text-late">{loadError}</p>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded-ctl border border-late px-3 py-1.5 text-[12.5px] font-medium text-late"
          data-testid="enrolment-retry"
        >
          Retry
        </button>
      </div>
    );
  }

  const loading = enrolments === null || batches === null;

  return (
    <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        Enrolment
      </h2>

      {loading ? (
        <p className="mt-2.5 text-[13px] text-ink-3">Loading…</p>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {enrolments!.length > 0 ? (
            <ul className="space-y-1.5">
              {enrolments!.map((e) => (
                <li key={e.batchId} className="text-[13.5px]">
                  {e.batchName} — {e.programName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">Not enrolled in any batch yet.</p>
          )}

          {availableBatches.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={effectiveBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
                data-testid="enrolment-batch-select"
              >
                {availableBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.programName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={enrol}
                disabled={busy || !effectiveBatchId}
                className="rounded-ctl bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                data-testid="enrol-member"
              >
                {busy ? "Enrolling…" : "Enrol"}
              </button>
            </div>
          ) : batches!.length === 0 ? (
            <p className="text-[13px] text-ink-3">No batches yet — add a program and batch first.</p>
          ) : (
            <p className="text-[13px] text-ink-3">Enrolled in every available batch.</p>
          )}
          {actionError ? <p className="text-[12px] text-late">{actionError}</p> : null}
        </div>
      )}
    </div>
  );
}
