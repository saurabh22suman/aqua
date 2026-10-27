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
import type { TerminologyState } from "@/lib/terminology/keys";
import { formatDateTimeIST, zonedWallTimeToInstant } from "@/lib/time/tz";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

export function EnquiryDetailView({
  enquiry,
  locations,
  batches,
  memberDetailBasePath = "/owner/members",
  terminology,
}: {
  enquiry: EnquiryDetail;
  locations: LocationOption[];
  batches: BatchWithProgramName[];
  // Where to send staff after converting — the member's own detail
  // page, where the Enrolment section (B3) picks up: a direct
  // conversion (no prior trial) has no batchId field on this form, so
  // enrolling is always this page's job, not this one's.
  memberDetailBasePath?: string;
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [followUpDue, setFollowUpDue] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");

  // Owner redesign (C2) — one workflow at a time. The trial form and
  // the conversion form are alternative next actions, so opening one
  // closes the other: "Trial and conversion forms should not be
  // expanded together."
  const [openWorkflow, setOpenWorkflow] = useState<"trial" | "convert" | null>(null);
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [trialDetails, setTrialDetails] = useState<NewMemberDetails | null>(null);
  const [trialValid, setTrialValid] = useState(false);

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
        dueAt: zonedWallTimeToInstant(
          followUpDue.slice(0, 10), followUpDue.slice(11, 16), "Asia/Kolkata",
        ).toISOString(),
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
      setOpenWorkflow(null);
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
      setOpenWorkflow(null);
      router.push(`${memberDetailBasePath}/${result.memberId}`);
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
              className="inline-flex min-h-11 items-center justify-center rounded-ctl border border-line bg-paper px-3 py-1.5 text-[12.5px] disabled:opacity-50"
            >
              Move to {ENQUIRY_STAGE_LABELS[s]}
            </button>
          ))}
          {ENQUIRY_STAGE_TRANSITIONS[enquiry.stage].includes("trial_scheduled") && !enquiry.memberId ? (
            <button
              type="button"
              onClick={() =>
                setOpenWorkflow((open) => (open === "trial" ? null : "trial"))
              }
              className="inline-flex min-h-11 items-center justify-center rounded-ctl border border-water bg-water-soft px-3 py-1.5 text-[12.5px] text-water"
              data-testid="show-book-trial"
            >
              Book trial
            </button>
          ) : null}
          {ENQUIRY_STAGE_TRANSITIONS[enquiry.stage].includes("converted") ? (
            <button
              type="button"
              onClick={() =>
                setOpenWorkflow((open) => (open === "convert" ? null : "convert"))
              }
              className="inline-flex min-h-11 items-center justify-center rounded-ctl border border-good bg-good-soft px-3 py-1.5 text-[12.5px] text-good"
              data-testid="show-convert"
            >
              Convert
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-[12px] text-late">{error}</p> : null}
      </div>

      {openWorkflow === "trial" ? (
        <section className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
          <h2 className="text-[13px] font-semibold">Book a trial</h2>
          <Field id="enquiry-trial-batch" label="Trial batch">
            {(field) => (
              <Select
                {...field}
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.programName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <EnquiryNewMemberFields
            locations={locations}
            onChange={setTrialDetails}
            onValidityChange={setTrialValid}
            terminology={terminology}
          />
          {/* Owner redesign (C2) — the workflow's dominant action is the
              shared STANDARD control (48px, the 10px radius, 16px
              text). The onClick, the disabled rule, the pending label
              and the test id are unchanged. */}
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={submitBookTrial}
            disabled={busy || !trialValid || !batchId}
            className="w-full"
            data-testid="submit-book-trial"
          >
            {busy ? "Booking…" : "Confirm trial booking"}
          </Button>
        </section>
      ) : null}

      {openWorkflow === "convert" ? (
        <section className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
          <h2 className="text-[13px] font-semibold">
            {enquiry.memberId ? "Convert to active member" : "Convert without a trial"}
          </h2>
          <Field id="enquiry-convert-reason" label="Reason (e.g. paid and enrolled)">
            {(field) => (
              <Input
                {...field}
                type="text"
                value={convertReason}
                onChange={(e) => setConvertReason(e.target.value)}
                placeholder="Reason (e.g. paid and enrolled)"
              />
            )}
          </Field>
          {!enquiry.memberId ? (
            <EnquiryNewMemberFields
              locations={locations}
              onChange={setConvertDetails}
              onValidityChange={setConvertValid}
              terminology={terminology}
            />
          ) : null}
          {/* The conversion's dominant action is the shared standard
              control too. Its old green was a STATUS tint on an action
              (DESIGN.md §1.2: the accent is the action colour, never a
              status colour); the conversion's meaning stays in the
              label and in the stage pill. */}
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={submitConvert}
            disabled={busy || (!enquiry.memberId && !convertValid)}
            className="w-full"
            data-testid="submit-convert"
          >
            {busy ? "Converting…" : "Confirm conversion"}
          </Button>
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
                  <p className="text-[11px] text-ink-3">{formatDateTimeIST(f.dueAt)}</p>
                </div>
                {f.doneAt ? (
                  <span className="text-[11px] text-good flex-none">Done</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => markFollowUpDone(f.id)}
                    className="flex-none"
                  >
                    Mark done
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>
        <div className="mt-2.5 rounded-card border border-line bg-paper p-3 space-y-3">
          <Field id="enquiry-follow-up-due" label="Due date and time (IST)">
            {(field) => (
              <Input
                {...field}
                type="datetime-local"
                lang="en-IN"
                value={followUpDue}
                onChange={(e) => setFollowUpDue(e.target.value)}
              />
            )}
          </Field>
          <Field id="enquiry-follow-up-note" label="Note (optional)">
            {(field) => (
              <Input
                {...field}
                type="text"
                value={followUpNote}
                onChange={(e) => setFollowUpNote(e.target.value)}
                placeholder="Note (optional)"
              />
            )}
          </Field>
          <Button
            type="button"
            variant="primary"
            onClick={submitFollowUp}
            disabled={busy || !followUpDue}
          >
            Add follow-up
          </Button>
        </div>
      </section>
    </div>
  );
}
