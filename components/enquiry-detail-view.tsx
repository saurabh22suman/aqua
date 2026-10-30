"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  addFollowUpAction,
  bookTrialAction,
  completeFollowUpAction,
  convertEnquiryAction,
  transitionEnquiryStageAction,
} from "@/lib/actions/enquiries";
import { ENQUIRY_STAGE_LABELS, ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
// Trial/conversion fields are requested only after opening that workflow.
const EnquiryNewMemberFields = dynamic(
  () => import("@/components/enquiry-new-member-fields").then((module) => module.EnquiryNewMemberFields),
  { loading: () => <p role="status" className="text-[13px] text-ink-3">Loading member form…</p> },
);
import type { EnquiryDetail } from "@/lib/services/enquiries";
import type { LocationOption } from "@/lib/services/people";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { EnquiryStage } from "@/db/schema/enquiries";
import type { NewMemberDetails } from "@/lib/services/enquiries";
import type { TerminologyState } from "@/lib/terminology/keys";
import { formatDateTimeIST, zonedWallTimeToInstant } from "@/lib/time/tz";
import { Button } from "@/components/ui/Button";
import {
  StatusBadge,
  ENQUIRY_STAGE_TONE,
} from "@/components/ui/StatusBadge";
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
      <section className="rounded-card border border-line bg-paper p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[16px] font-semibold text-ink">
              Current stage
            </h2>
            <p className="mt-1.5">
              <StatusBadge tone={ENQUIRY_STAGE_TONE[enquiry.stage] ?? "neutral"}>
                {ENQUIRY_STAGE_LABELS[enquiry.stage]}
              </StatusBadge>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {stageOptions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => moveStage(s)}
                disabled={busy}
                className="inline-flex min-h-11 items-center justify-center rounded-ctl border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-2 hover:text-ink disabled:opacity-50"
              >
                Move to {ENQUIRY_STAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-[12.5px] text-late">
            {error}
          </p>
        ) : null}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section
          aria-labelledby="follow-up-timeline-heading"
          className="rounded-card border border-line bg-paper p-5"
        >
          <h2
            id="follow-up-timeline-heading"
            className="font-display text-[16px] font-semibold text-ink"
          >
            Follow-up timeline
          </h2>
          <ul className="mt-1 divide-y divide-line">
            {enquiry.followUps.length === 0 ? (
              <li className="py-3 text-[13px] text-ink-3">No follow-ups yet.</li>
            ) : (
              enquiry.followUps.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink">
                      {f.note ?? "Follow up"}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      {f.doneAt ? "Done" : "Due"} ·{" "}
                      {formatDateTimeIST(f.dueAt)}
                    </p>
                  </div>
                  {f.doneAt ? (
                    <span className="flex-none text-[11.5px] text-good">Done</span>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
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

          <details className="mt-3 border-t border-line pt-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-medium text-ink-2">
              Add follow-up
            </summary>
            <div className="mt-2 space-y-3">
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
                size="md"
                onClick={submitFollowUp}
                disabled={busy || !followUpDue}
              >
                Add follow-up
              </Button>
            </div>
          </details>
        </section>

        <section
          aria-labelledby="next-action-heading"
          className="rounded-card border border-line bg-paper p-5"
        >
          <h2
            id="next-action-heading"
            className="font-display text-[16px] font-semibold text-ink"
          >
            Next action
          </h2>

          <div className="mt-3 flex flex-wrap gap-2">
            {ENQUIRY_STAGE_TRANSITIONS[enquiry.stage].includes("trial_scheduled") &&
            !enquiry.memberId ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() =>
                  setOpenWorkflow((open) => (open === "trial" ? null : "trial"))
                }
                data-testid="show-book-trial"
              >
                Book a trial
              </Button>
            ) : null}
            {ENQUIRY_STAGE_TRANSITIONS[enquiry.stage].includes("converted") ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() =>
                  setOpenWorkflow((open) => (open === "convert" ? null : "convert"))
                }
                data-testid="show-convert"
              >
                Convert to member
              </Button>
            ) : null}
          </div>

          {openWorkflow === "trial" ? (
            <div className="mt-4 space-y-2.5">
              <h3 className="text-[14px] font-medium text-ink">Book a trial</h3>
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
            </div>
          ) : null}

          {openWorkflow === "convert" ? (
            <div className="mt-4 space-y-2.5">
              <h3 className="text-[14px] font-medium text-ink">
                {enquiry.memberId
                  ? "Convert to active member"
                  : "Convert without a trial"}
              </h3>
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
            </div>
          ) : null}

          {openWorkflow === null ? (
            <p className="mt-3 text-[12.5px] text-ink-3">
              Open a trial or conversion when it is the right next step. Only
              one workflow is open at a time.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
