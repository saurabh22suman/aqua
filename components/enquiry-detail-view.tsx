"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bookTrialAction, convertEnquiryAction, transitionEnquiryStageAction } from "@/lib/actions/enquiries";
import { ENQUIRY_STAGE_LABELS, ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
import type { EnquiryStage } from "@/db/schema/enquiries";
import type { EnquiryDetail, NewMemberDetails } from "@/lib/services/enquiries";
import type { LocationOption } from "@/lib/services/people";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { TerminologyState } from "@/lib/terminology/keys";
import { EnquiryFollowUps } from "@/components/enquiry-follow-ups";
import { Button, buttonClasses } from "@/components/ui/Button";
import { StatusBadge, ENQUIRY_STAGE_TONE } from "@/components/ui/StatusBadge";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

const EnquiryNewMemberFields = dynamic(
  () => import("@/components/enquiry-new-member-fields").then((module) => module.EnquiryNewMemberFields),
  { loading: () => <p role="status" className="text-sm text-ink-2">Loading member details…</p> },
);

const STAGE_ACTIONS: Partial<Record<EnquiryStage, string>> = {
  new: "Reopen enquiry",
  contacted: "Mark contacted",
  trial_completed: "Mark trial complete",
  lost: "Mark as lost",
};

type Workflow = "trial" | "convert";

export function EnquiryDetailView({
  enquiry,
  locations,
  batches,
  memberDetailBasePath = "/owner/members",
  terminology,
  canWrite = true,
  canOpenMember = true,
}: {
  enquiry: EnquiryDetail;
  locations: LocationOption[];
  batches: BatchWithProgramName[];
  memberDetailBasePath?: string;
  terminology: TerminologyState;
  canWrite?: boolean;
  canOpenMember?: boolean;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [details, setDetails] = useState<NewMemberDetails | null>(null);
  const [guardianLabel, setGuardianLabel] = useState("");
  const [batchId, setBatchId] = useState("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [convertedId, setConvertedId] = useState<string | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  const transitions = ENQUIRY_STAGE_TRANSITIONS[enquiry.stage];
  const canBook = canWrite && transitions.includes("trial_scheduled") && !enquiry.memberId;
  const canConvert = canWrite && transitions.includes("converted");
  const stageOptions = canWrite ? transitions.filter((stage) => stage in STAGE_ACTIONS) : [];
  const recommendedStage = stageOptions.find((stage) => stage !== "lost");
  const memberId = convertedId ?? enquiry.memberId;
  const converted = Boolean(convertedId) || enquiry.stage === "converted";
  const selectedFacility = locations.find((location) => location.id === (details?.locationId ?? enquiry.locationId));
  const trialBatch = batches.find((batch) => batch.id === enquiry.trialBatchId);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch {
      setError("Could not confirm the update. Check the current stage before trying again.");
      router.refresh();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function open(next: Workflow) {
    setWorkflow(next);
    setReview(false);
    setDetails(null);
    setGuardianLabel("");
    setError(null);
    setMessage(null);
  }

  async function moveStage(stage: EnquiryStage) {
    await run(async () => {
      const result = await transitionEnquiryStageAction({ enquiryId: enquiry.id, toStage: stage });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWorkflow(null);
      setMessage(`Enquiry updated to ${ENQUIRY_STAGE_LABELS[stage].toLowerCase()}.`);
      router.refresh();
    });
  }

  async function bookTrial() {
    if (!details || !batchId) return;
    await run(async () => {
      const result = await bookTrialAction({ enquiryId: enquiry.id, batchId, details });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWorkflow(null);
      setMessage("Trial booked. You can track it from this enquiry.");
      router.refresh();
    });
  }

  async function convert() {
    if (!enquiry.memberId && !details) return;
    await run(async () => {
      const result = await convertEnquiryAction({
        enquiryId: enquiry.id,
        reason: reason.trim() || "converted",
        newMember: enquiry.memberId ? undefined : details ?? undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConvertedId(result.memberId);
      setWorkflow(null);
      setMessage(`${enquiry.fullName} is now a member.`);
      router.refresh();
    });
  }

  const memberLink = memberId && canOpenMember ? (
    <Link href={`${memberDetailBasePath}/${memberId}`} className={buttonClasses({ variant: "primary" })}>
      Open member profile
    </Link>
  ) : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="min-w-0 rounded-card border border-line bg-paper p-4 sm:p-5" aria-labelledby="next-action-heading">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 tabIndex={-1} id="next-action-heading" className="text-lg font-bold">{converted ? "Membership created" : "Next action"}</h2>
          <StatusBadge tone={ENQUIRY_STAGE_TONE[converted ? "converted" : enquiry.stage]}>
            {ENQUIRY_STAGE_LABELS[converted ? "converted" : enquiry.stage]}
          </StatusBadge>
        </header>
        {trialBatch ? <p className="mt-2 text-sm text-ink-2">Trial batch · {trialBatch.name}</p> : null}
        {selectedFacility ? <p className="mt-1 text-sm text-ink-2">{selectedFacility.name}</p> : null}

        {converted ? (
          <div className="mt-4 space-y-3">
            {message ? <p role="status" className="text-sm text-good">{message}</p> : null}
            {memberLink}
          </div>
        ) : workflow === null ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {recommendedStage ? (
              <Button variant="primary" disabled={busy} onClick={() => void moveStage(recommendedStage)}>
                {STAGE_ACTIONS[recommendedStage]}
              </Button>
            ) : null}
            {canBook ? (
              <Button variant={!recommendedStage && batches.length ? "primary" : "secondary"} disabled={busy || !batches.length}
                onClick={() => open("trial")} data-testid="show-book-trial">Book a trial</Button>
            ) : null}
            {canConvert ? (
              <Button variant={!recommendedStage && (!canBook || !batches.length) ? "primary" : "secondary"} disabled={busy}
                onClick={() => open("convert")} data-testid="show-convert">Convert to member</Button>
            ) : null}
            {canBook && !batches.length ? <p className="w-full text-sm text-ink-2">No trial batches are available.</p> : null}
            {stageOptions.includes("lost") ? (
              <details className="w-full">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-2 underline">Other actions</summary>
                <Button variant="secondary" disabled={busy} onClick={() => void moveStage("lost")}>Mark as lost</Button>
              </details>
            ) : null}
            {!canWrite ? <p className="text-sm text-ink-2">You have read access to this enquiry.</p> : null}
          </div>
        ) : (
          <div className="mt-4 border-t border-line pt-4">
            <div hidden={review} className="space-y-3">
              <h3 className="font-semibold">{workflow === "trial" ? "Book a trial" : "Prepare conversion"}</h3>
              {workflow === "trial" ? (
                <Field id="enquiry-trial-batch" label="Trial batch" required>
                  {(field) => (
                    <Select {...field} value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                      <option value="">Select trial batch</option>
                      {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.programName}</option>)}
                    </Select>
                  )}
                </Field>
              ) : (
                <Field id="enquiry-convert-reason" label="Reason (optional)">
                  {(field) => <Input {...field} value={reason} onChange={(event) => setReason(event.target.value)} />}
                </Field>
              )}
              {!enquiry.memberId ? (
                <EnquiryNewMemberFields key={workflow} locations={locations} initialLocationId={enquiry.locationId}
                  onChange={setDetails} onGuardianSummaryChange={setGuardianLabel} terminology={terminology} />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {workflow === "trial" ? (
                  <Button variant="primary" disabled={busy || !details || !batchId} onClick={() => void bookTrial()} data-testid="submit-book-trial">
                    {busy ? "Booking…" : "Confirm trial booking"}
                  </Button>
                ) : (
                  <Button variant="primary" disabled={busy || (!enquiry.memberId && !details)} onClick={() => {
                    setReview(true);
                    requestAnimationFrame(() => reviewHeading.current?.focus());
                  }}>Review conversion</Button>
                )}
                <Button variant="ghost" disabled={busy} onClick={() => { setWorkflow(null); setError(null); }}>Back to actions</Button>
              </div>
            </div>
            {review ? (
              <div className="space-y-3">
                <h3 tabIndex={-1} ref={reviewHeading} className="font-semibold">Review conversion</h3>
                <dl className="space-y-1 rounded-ctl bg-deck p-3 text-sm">
                  <div><dt className="inline text-ink-2">Member · </dt><dd className="inline font-semibold">{enquiry.fullName}</dd></div>
                  {selectedFacility ? <div><dt className="inline text-ink-2">Facility · </dt><dd className="inline">{selectedFacility.name}</dd></div> : null}
                  {guardianLabel ? <div><dt className="inline text-ink-2">Guardian · </dt><dd className="inline">{guardianLabel}</dd></div> : null}
                  {enquiry.memberId ? <div><dt className="inline text-ink-2">Membership · </dt><dd className="inline">Activate the existing trial membership</dd></div> : null}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void convert()} data-testid="submit-convert">
                    {busy ? "Converting…" : "Confirm conversion"}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => { setReview(false); setError(null); }}>Edit details</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {!converted && message ? <p role="status" className="mt-4 text-sm text-good">{message}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-ctl bg-late-soft p-3 text-sm text-late">{error}</p> : null}
      </section>

      <div className="min-w-0 space-y-4">
        {enquiry.notes ? (
          <section className="rounded-card border border-line bg-paper p-4" aria-labelledby="enquiry-notes-heading">
            <h2 tabIndex={-1} id="enquiry-notes-heading" className="font-semibold">Enquiry notes</h2>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink-2">{enquiry.notes}</p>
          </section>
        ) : null}
        <EnquiryFollowUps enquiry={enquiry} canWrite={canWrite} />
      </div>
    </div>
  );
}
