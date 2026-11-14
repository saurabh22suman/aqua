"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { previewAnnouncementAudienceAction, sendAnnouncementAction } from "@/lib/actions/announcements";
import type { AnnouncementAudiencePreview, AnnouncementAudiencePreviewInput } from "@/lib/services/announcements";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

// In-app notifications and consent-checked WhatsApp outbox delivery.
//
// Owner redesign (C2) — the composer is a native <form>: Enter in a
// field submits it, and a screen reader announces the real control.
// The fields are the shared primitives, so their metrics and tints stay
// with the foundation owner.

export function AnnouncementComposer({
  batches,
  memberLabel,
  batchLabel,
  guardianLabel,
}: {
  batches: Array<{ id: string; name: string }>;
  // Resolved through resolveTerm on the server (L3 scan: "members"
  // and "batch" change meaning when a preset overrides the closed-key
  // vocabulary).
  memberLabel: string;
  batchLabel: string;
  guardianLabel: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"" | "all" | "batch" | "parents">("");
  const [batchId, setBatchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<{key:string; result:Extract<AnnouncementAudiencePreview,{ok:true}>} | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewEpoch = useRef(0);
  const reviewKey = `${audience}:${audience === "batch" ? batchId : ""}`;
  const reviewed = review?.key === reviewKey ? review.result : null;

  function clearReview() { reviewEpoch.current += 1; setReview(null); setMessage(null); }
  async function reviewAudience() {
    if (!audience || (audience === "batch" && !batchId)) return;
    const input: AnnouncementAudiencePreviewInput = audience === "batch" ? {audience,batchId} : {audience};
    const epoch = ++reviewEpoch.current;
    setReview(null); setMessage(null); setReviewBusy(true);
    try {
      const result = await previewAnnouncementAudienceAction(input);
      if (epoch !== reviewEpoch.current) return;
      if (!result.ok) { setMessage(result.error); return; }
      setReview({key:reviewKey,result});
    } catch {
      if (epoch === reviewEpoch.current) setMessage("Audience preview could not be loaded. Try again.");
    } finally { if (epoch === reviewEpoch.current) setReviewBusy(false); }
  }

  async function send() {
    if (!audience || !reviewed || reviewed.inApp.eligibleCount + reviewed.whatsapp.eligibleCount === 0 || reviewBusy || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // A structured result proves its own outcome: ok:true is a committed
      // send, ok:false is a refusal made before any write. A THROWN result
      // proves nothing about delivery, so it is handled as UNKNOWN below —
      // never as a confirmed failure and never retried automatically.
      let result: Awaited<ReturnType<typeof sendAnnouncementAction>>;
      try {
        result = await sendAnnouncementAction({
          title,
          body,
          audience,
          ...(audience === "batch" ? { batchId } : {}),
        });
      } catch {
        setMessage(
          "The result could not be confirmed — the announcement may or may not have been sent. Messaging may not be enabled for this academy, or the response did not reach this screen. Refresh the sent list before retrying, so an announcement is not sent twice.",
        );
        return;
      }
      setMessage(
        result.ok
          ? `Sent in-app to ${result.recipientCount} account${
              result.recipientCount === 1 ? "" : "s"
            }. WhatsApp queued for ${result.whatsappRecipientCount ?? 0} number${
              result.whatsappRecipientCount === 1 ? "" : "s"
            }.`
          : result.error,
      );
      if (result.ok) {
        setTitle("");
        setBody("");
        reviewEpoch.current += 1;
        setReview(null);
        // The refresh re-renders the page tree; it is not part of the
        // send. A refresh failure must not rewrite a confirmed outcome.
        try {
          router.refresh();
        } catch {
          // Keep the success message above.
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rounded-card border border-line bg-paper p-5"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void send();
      }}
    >
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Compose an announcement
      </h2>
      <p className="mt-1 max-w-[65ch] text-[12.5px] text-ink-3">
        Creates in-app notifications and queues WhatsApp updates for selected
        contacts and relevant staff. Student updates require active communications consent.
      </p>

      <div className="mt-3 space-y-3">
        <Field id="announcement-title" label="Title">
          {(field) => (
            <Input
              {...field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder="Pool closed on Saturday"
            />
          )}
        </Field>

        <Field id="announcement-message" label="Message">
          {(field) => (
            <Textarea
              {...field}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Maintenance work means the 7am batch moves to Sunday."
            />
          )}
        </Field>

        <Field id="announcement-audience" label="Audience">
          {(field) => (
            <Select
              {...field}
              value={audience}
              onChange={(e) =>
                { clearReview(); setReviewBusy(false); setAudience(e.target.value as "" | "all" | "batch" | "parents"); }
              }
            >
              <option value="">Choose an audience</option>
              <option value="all">Everyone</option>
              <option value="batch">One {batchLabel.toLowerCase()}</option>
              <option value="parents">Parents and {guardianLabel.toLowerCase()}</option>
            </Select>
          )}
        </Field>
        <p className="text-[12.5px] text-ink-3">
          {audience === "" ? "Choose who should receive this announcement." : audience === "all" ? "Staff and linked accounts." : audience === "batch"
            ? `One ${batchLabel.toLowerCase()}'s ${memberLabel.toLowerCase()} and ${guardianLabel.toLowerCase()}.`
            : `Parents and ${guardianLabel.toLowerCase()} only.`}
        </p>

        {audience === "batch" ? (
          batches.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">
              No batches exist yet — create one before announcing to a batch.
            </p>
          ) : (
            <Field id="announcement-batch" label={batchLabel}>
              {(field) => (
                <Select
                  {...field}
                  value={batchId}
                  onChange={(e) => { clearReview(); setReviewBusy(false); setBatchId(e.target.value); }}
                >
                  <option value="">Choose a {batchLabel.toLowerCase()}</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )
        ) : null}
      </div>

      <Button type="button" variant="secondary" size="md" className="mt-3" onClick={() => void reviewAudience()} disabled={!audience || (audience === "batch" && !batchId) || reviewBusy || busy}>
        {reviewBusy ? "Reviewing…" : "Review audience"}
      </Button>
      {reviewed ? <div className="mt-3 rounded-ctl border border-line p-3 text-[13px] text-ink-2" role="status">
        <p>{audience === "all" ? "Everyone" : audience === "parents" ? "Parents and guardians" : batches.find((batch) => batch.id === batchId)?.name} · estimate as of {reviewed.asOf}</p>
        <p>{reviewed.inApp.eligibleCount} eligible in-app account destinations · {reviewed.whatsapp.eligibleCount} eligible WhatsApp destinations</p>
        {reviewed.inApp.exclusions ? <p>In-app exclusions: {reviewed.inApp.exclusions.unlinked} unlinked, {reviewed.inApp.exclusions.revokedOrPending} revoked or pending.</p> : null}
        {reviewed.whatsapp.exclusions ? <p>WhatsApp exclusions: {reviewed.whatsapp.exclusions.noDestination} without destination, {reviewed.whatsapp.exclusions.noConsent} without consent, {reviewed.whatsapp.exclusions.revokedOrOutOfScope} revoked or out of scope.</p> : null}
        <p>This is an estimate, not delivery confirmation. WhatsApp is queued, not guaranteed delivered.</p>
      </div> : null}

      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={
          busy ||
          title.trim().length === 0 ||
          body.trim().length === 0 ||
          !reviewed || reviewBusy || (reviewed.inApp.eligibleCount + reviewed.whatsapp.eligibleCount === 0) ||
          (audience === "batch" && !batchId)
        }
        className="mt-3"
      >
        {busy ? "Sending…" : "Send announcement"}
      </Button>

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </form>
  );
}
