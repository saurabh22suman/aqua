"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { addFollowUpAction, completeFollowUpAction } from "@/lib/actions/enquiries";
import type { EnquiryDetail } from "@/lib/services/enquiries";
import { formatDateTimeIST, zonedWallTimeToInstant } from "@/lib/time/tz";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { TimeField } from "@/components/ui/TimeField";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

export function EnquiryFollowUps({ enquiry, canWrite }: { enquiry: EnquiryDetail; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  // Both parts report their validity, so an unfinished or impossible
  // entry can never be submitted behind the operator's back.
  const [followUpDateValid, setFollowUpDateValid] = useState(true);
  const [followUpTimeValid, setFollowUpTimeValid] = useState(true);


  async function submitFollowUp() {
    if (busy || !followUpDate || !followUpTime || !followUpDateValid || !followUpTimeValid) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await addFollowUpAction({
        enquiryId: enquiry.id,
        dueAt: zonedWallTimeToInstant(followUpDate, followUpTime, "Asia/Kolkata").toISOString(),
        note: followUpNote.trim() || undefined,
      });
      setFollowUpDate("");
      setFollowUpTime("");
      setFollowUpNote("");
      setMessage("Follow-up added.");
      router.refresh();
    } catch {
      setError("Could not confirm the follow-up. Check the timeline before adding it again.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function markFollowUpDone(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await completeFollowUpAction(id);
      setMessage("Follow-up marked done.");
      router.refresh();
    } catch {
      setError("Could not confirm the update. Check the timeline and try again.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="follow-up-timeline-heading"
      className="rounded-card border border-line bg-paper p-5"
    >
      <h2
        tabIndex={-1} id="follow-up-timeline-heading"
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
              ) : canWrite ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void markFollowUpDone(f.id)}
                  disabled={busy}
                  className="flex-none"
                >
                  Mark done
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {canWrite ? <details className="group mt-3 border-t border-line pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
          {/* The approved contextual plus on the opener; the native
              disclosure keeps its own chevron for the open state. */}
          <OwnerIcon name="plus" size={14} />
          Add follow-up
          <ChevronDown size={14} aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="mt-2 space-y-3">
          {/* One date + time group, built from the product's shared
              controls: the masked day-first DATE field and the
              hour/minutes/AM-PM TIME field. The native
              `datetime-local` input it replaces rendered US
              mm/dd/yyyy segments on this locale and asked the
              browser for a value the product could not read back
              in its own format. */}
          <fieldset className="min-w-0">
            <legend className="block text-[13px] font-medium text-ink-2">
              Due date and time (IST)
            </legend>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <label
                  htmlFor="enquiry-follow-up-due-date"
                  className="sr-only"
                >
                  Due date
                </label>
                <DateField
                  id="enquiry-follow-up-due-date"
                  value={followUpDate}
                  onChange={setFollowUpDate}
                  onValidityChange={setFollowUpDateValid}
                  aria-label="Due date"
                  formatHint="sr-only"
                />
              </div>
              <TimeField
                id="enquiry-follow-up-due-time"
                label="Due time"
                value={followUpTime}
                onChange={setFollowUpTime}
                onValidityChange={setFollowUpTimeValid}
                hourLabel="Due hour"
                minuteLabel="Due minutes"
                periodLabel="Due AM/PM"
              />
            </div>
          </fieldset>
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
            disabled={
              busy ||
              !followUpDate ||
              !followUpTime ||
              !followUpDateValid ||
              !followUpTimeValid
            }
          >
            Add follow-up
          </Button>
        </div>
      </details> : null}
      {message ? <p role="status" className="mt-3 text-sm text-ink-2">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-late">{error}</p> : null}
    </section>
  );
}
