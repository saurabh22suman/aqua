"use client";

export function MemberConsentChoices({ minor, memberLabel, processing, communications, onProcessing, onCommunications }: {
  minor: boolean | null; memberLabel: string; processing: boolean; communications: boolean;
  onProcessing: (checked: boolean) => void; onCommunications: (checked: boolean) => void;
}) {
  // Owner redesign (C2) — each choice is associated with its own
  // label by id, so a pointer click on the copy and a screen reader's
  // announcement point at the same control.
  return <fieldset className="space-y-2">
    <legend className="sr-only">Consent choices</legend>
    <label htmlFor="member-consent-processing" className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-ctl px-1 py-2.5 -mx-1 hover:bg-deck/40">
      <input id="member-consent-processing" type="checkbox" checked={processing}
        onChange={(event) => onProcessing(event.currentTarget.checked)}
        className="mt-0.5 h-5 w-5 flex-none accent-[var(--accent-strong)]" data-testid="consent-checkbox" />
      <span className="text-[12.5px] text-ink-2">{minor === true
        ? `The guardian above has agreed to data processing for this ${memberLabel}, per the current privacy notice.`
        : `This ${memberLabel} has agreed to data processing, per the current privacy notice.`}</span>
    </label>
    <label htmlFor="member-consent-communications" className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-ctl px-1 py-2.5 -mx-1 hover:bg-deck/40">
      <input id="member-consent-communications" type="checkbox" checked={communications}
        onChange={(event) => onCommunications(event.currentTarget.checked)}
        className="mt-0.5 h-5 w-5 flex-none accent-[var(--accent-strong)]" data-testid="communications-consent-checkbox" />
      <span className="text-[12.5px] text-ink-2">{minor === true
        ? "The guardian above agrees to optional academy communications, including WhatsApp announcements and attendance updates."
        : `This ${memberLabel} agrees to optional academy communications, including WhatsApp announcements and attendance updates.`}
        <span className="mt-1 block">Optional. Messages go only to selected linked numbers. Withdrawing this choice stops optional updates such as announcements, attendance alerts and progress notes. Essential fee and receipt notices follow separate rules.</span>
      </span>
    </label>
  </fieldset>;
}
