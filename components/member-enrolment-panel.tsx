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

export function MemberEnrolmentPanel({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [enrolments, setEnrolments] = useState<MemberEnrolment[] | null>(null);
  const [batches, setBatches] = useState<BatchWithProgramName[] | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listMemberEnrolmentsAction(memberId).then(setEnrolments);
    listBatchesAction().then((rows) => {
      setBatches(rows);
      setSelectedBatchId((current) => current || rows[0]?.id || "");
    });
  }, [memberId]);

  async function enrol() {
    if (!selectedBatchId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await enrolMemberAction({ memberId, batchId: selectedBatchId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const rows = await listMemberEnrolmentsAction(memberId);
      setEnrolments(rows);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        Enrolment
      </h2>

      {enrolments === null ? null : enrolments.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {enrolments.map((e) => (
            <li key={e.batchId} className="text-[13.5px]">
              {e.batchName} — {e.programName}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          <p className="text-[13px] text-ink-3">Not enrolled in any batch yet.</p>
          {batches && batches.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
                data-testid="enrolment-batch-select"
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.programName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={enrol}
                disabled={busy || !selectedBatchId}
                className="rounded-ctl bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                data-testid="enrol-member"
              >
                {busy ? "Enrolling…" : "Enrol"}
              </button>
            </div>
          ) : batches ? (
            <p className="text-[13px] text-ink-3">No batches yet — add a program and batch first.</p>
          ) : null}
          {error ? <p className="text-[12px] text-late">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
