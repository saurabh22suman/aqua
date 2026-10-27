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
    <div className="flex min-h-[44px] items-start gap-2.5 py-1">
      <input id="member-consent-processing" type="checkbox" checked={processing}
        onChange={(event) => onProcessing(event.currentTarget.checked)}
        className="mt-0.5 h-5 w-5 flex-none accent-[var(--accent-strong)]" data-testid="consent-checkbox" />
      <label htmlFor="member-consent-processing" className="text-[12.5px] text-ink-2">{minor === true
        ? `The guardian above has agreed to data processing for this ${memberLabel}, per the current privacy notice.`
        : `This ${memberLabel} has agreed to data processing, per the current privacy notice.`}</label>
    </div>
    <div className="flex min-h-[44px] items-start gap-2.5 py-1">
      <input id="member-consent-communications" type="checkbox" checked={communications}
        onChange={(event) => onCommunications(event.currentTarget.checked)}
        className="mt-0.5 h-5 w-5 flex-none accent-[var(--accent-strong)]" data-testid="communications-consent-checkbox" />
      <label htmlFor="member-consent-communications" className="text-[12.5px] text-ink-2">{minor === true
        ? "The guardian above agrees to optional academy communications, including WhatsApp announcements and attendance updates."
        : `This ${memberLabel} agrees to optional academy communications, including WhatsApp announcements and attendance updates.`}
        <span className="mt-1 block">Optional. Notifications go only to selected linked numbers and stop when communications consent is withdrawn.</span>
      </label>
    </div>
  </fieldset>;
}
