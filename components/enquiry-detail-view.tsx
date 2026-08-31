"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addFollowUpAction,
  bookTrialAction,
  completeFollowUpAction,
  convertEnquiryAction,
  transitionEnquiryStageAction,
} from "@/lib/actions/enquiries";
import { ENQUIRY_STAGE_LABELS, ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
import { EnquiryNewMemberFields } from "@/components/enquiry-new-member-fields";
import type { EnquiryDetail } from "@/lib/services/enquiries";
import type { LocationOption } from "@/lib/services/people";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { EnquiryStage } from "@/db/schema/enquiries";
import type { NewMemberDetails } from "@/lib/services/enquiries";

export function EnquiryDetailView({
  enquiry,
  locations,
  batches,
}: {
  enquiry: EnquiryDetail;
  locations: LocationOption[];
  batches: BatchWithProgramName[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [followUpDue, setFollowUpDue] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");

  const [showBookTrial, setShowBookTrial] = useState(false);
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [trialDetails, setTrialDetails] = useState<NewMemberDetails | null>(null);
  const [trialValid, setTrialValid] = useState(false);

  const [showConvertNoTrial, setShowConvertNoTrial] = useState(false);
  const [convertDetails, setConvertDetails] = useState<NewMemberDetails | null>(null);
  const [convertValid, setConvertValid] = useState(false);
  const [convertReason, setConvertReason] = useState("");

  const stageOptions = ENQUIRY_STAGE_TRANSITIONS[enquiry.stage].filter(
    (s) => s !== "trial_scheduled" && s !== "converted",
  );

  async function moveStage(toStage: EnquiryStage) {
    setError(null);
    setBusy(true);
    try {
      const result = await transitionEnquiryStageAction({ enquiryId: enquiry.id, toStage });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitFollowUp() {
    if (!followUpDue) return;
    setBusy(true);
    setError(null);
    try {
      await addFollowUpAction({
        enquiryId: enquiry.id,
        dueAt: new Date(followUpDue).toISOString(),
        note: followUpNote.trim() || undefined,
      });
      setFollowUpDue("");
      setFollowUpNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function markFollowUpDone(id: string) {
    await completeFollowUpAction(id);
    router.refresh();
  }

  async function submitBookTrial() {
    if (!trialDetails || !batchId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bookTrialAction({ enquiryId: enquiry.id, batchId, details: trialDetails });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShowBookTrial(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitConvert() {
    setBusy(true);
    setError(null);
    try {
      const result = await convertEnquiryAction({
        enquiryId: enquiry.id,
        reason: convertReason.trim() || "converted",
        newMember: enquiry.memberId ? undefined : convertDetails ?? undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShowConvertNoTrial(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-line bg-paper p-3.5">
        <p className="text-[12px] text-ink-3">Stage</p>
        <p className="mt-0.5 font-display text-[16px] font-semibold">{ENQUIRY_STAGE_LABELS[enquiry.stage]}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {stageOptions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => moveStage(s)}
              disabled={busy}
              className="rounded-ctl border border-line bg-paper px-3 py-1.5 text-[12.5px] disabled:opacity-50"
            >
              Move to {ENQUIRY_STAGE_LABELS[s]}
            </button>
          ))}
          {ENQUIRY_STAGE_TRANSITIONS[enquiry.stage].includes("trial_scheduled") && !enquiry.memberId ? (
            <button
              type="button"
              onClick={() => setShowBookTrial((v) => !v)}
              className="rounded-ctl border border-water bg-water-soft px-3 py-1.5 text-[12.5px] text-water"
              data-testid="show-book-trial"
            >
              Book trial
            </button>
          ) : null}
          {ENQUIRY_STAGE_TRANSITIONS[enquiry.stage].includes("converted") ? (
            <button
              type="button"
              onClick={() => setShowConvertNoTrial((v) => !v)}
              className="rounded-ctl border border-good bg-good-soft px-3 py-1.5 text-[12.5px] text-good"
              data-testid="show-convert"
            >
              Convert
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-[12px] text-late">{error}</p> : null}
      </div>

      {showBookTrial ? (
        <section className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
          <h2 className="text-[13px] font-semibold">Book a trial</h2>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.programName}
              </option>
            ))}
          </select>
          <EnquiryNewMemberFields locations={locations} onChange={setTrialDetails} onValidityChange={setTrialValid} />
          <button
            type="button"
            onClick={submitBookTrial}
            disabled={busy || !trialValid || !batchId}
            className="w-full rounded-ctl bg-mango py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
            data-testid="submit-book-trial"
          >
            {busy ? "Booking…" : "Confirm trial booking"}
          </button>
        </section>
      ) : null}

      {showConvertNoTrial ? (
        <section className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
          <h2 className="text-[13px] font-semibold">
            {enquiry.memberId ? "Convert to active member" : "Convert without a trial"}
          </h2>
          <input
            type="text"
            value={convertReason}
            onChange={(e) => setConvertReason(e.target.value)}
            placeholder="Reason (e.g. paid and enrolled)"
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
          />
          {!enquiry.memberId ? (
            <EnquiryNewMemberFields locations={locations} onChange={setConvertDetails} onValidityChange={setConvertValid} />
          ) : null}
          <button
            type="button"
            onClick={submitConvert}
            disabled={busy || (!enquiry.memberId && !convertValid)}
            className="w-full rounded-ctl bg-good py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
            data-testid="submit-convert"
          >
            {busy ? "Converting…" : "Confirm conversion"}
          </button>
        </section>
      ) : null}

      <section>
        <h2 className="font-display text-[14px] font-semibold">Follow-ups</h2>
        <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
          {enquiry.followUps.length === 0 ? (
            <li className="px-3.5 py-3 text-[13px] text-ink-3">No follow-ups yet.</li>
          ) : (
            enquiry.followUps.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">{f.note ?? "Follow up"}</p>
                  <p className="text-[11px] text-ink-3">{new Date(f.dueAt).toLocaleString("en-IN")}</p>
                </div>
                {f.doneAt ? (
                  <span className="text-[11px] text-good flex-none">Done</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => markFollowUpDone(f.id)}
                    className="text-[11px] text-water flex-none"
                  >
                    Mark done
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
        <div className="mt-2.5 rounded-card border border-line bg-paper p-3 space-y-2">
          <input
            type="datetime-local"
            value={followUpDue}
            onChange={(e) => setFollowUpDue(e.target.value)}
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
          />
          <input
            type="text"
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
          />
          <button
            type="button"
            onClick={submitFollowUp}
            disabled={busy || !followUpDue}
            className="rounded-ctl bg-mango px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          >
            Add follow-up
          </button>
        </div>
      </section>
    </div>
  );
}
