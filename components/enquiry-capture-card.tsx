// The quick enquiry capture card.
//
// PRESENTATION ONLY. The board owns the capture's state, the save and
// the error; this file draws the form and reports what the owner typed.
// It holds no state of its own, so the card can never disagree with the
// enquiry that is saved.
//
// The one thing it does NOT own is the focus: the card receives the
// real name field's ref, so the owner who OPENS the capture gets the
// focus and the field is brought into the viewport. Reception's capture
// is always visible, so nothing is ever focused for them.

import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

/** The sources a capture can be typed in as. */
export const CAPTURE_SOURCES = [
  "walk-in",
  "phone",
  "referral",
  "online",
  "other",
] as const;

export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export function EnquiryCaptureCard({
  fullName,
  phone,
  source,
  locationId,
  locations,
  error,
  phoneError,
  busy,
  nameFieldRef,
  phoneFieldRef,
  onFullName,
  onPhone,
  onSource,
  onLocationId,
  onSubmit,
}: {
  fullName: string;
  phone: string;
  source: CaptureSource;
  locationId: string;
  locations: Array<{ id: string; name: string }>;
  error: string | null;
  phoneError: string | null;
  busy: boolean;
  /**
   * The real name field, so the owner who OPENS the capture gets the
   * focus (and the field is brought into the viewport). The capture card
   * owns no focus of its own.
   */
  nameFieldRef: React.RefObject<HTMLInputElement | null>;
  phoneFieldRef: React.RefObject<HTMLInputElement | null>;
  onFullName: (value: string) => void;
  onPhone: (value: string) => void;
  onSource: (value: CaptureSource) => void;
  onLocationId: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-card border border-line bg-paper p-3.5 space-y-3">
      <p className="text-[13px] font-medium">Quick capture</p>

      {/* Owner redesign (C2) — shared labelled controls. The capture
          card uses the primitives' own tints: a neutral entry field and
          the shared picker surface. No page-local surface override is
          added on top of them. */}
      <Field id="enquiry-capture-name-field" label="Name">
        {(field) => (
          <Input
            {...field}
            ref={nameFieldRef}
            type="text"
            value={fullName}
            onChange={(e) => onFullName(e.target.value)}
            data-testid="enquiry-capture-name"
          />
        )}
      </Field>

      <Field id="enquiry-capture-phone-field" label="Phone (optional)" error={phoneError}>
        {(field) => (
          <Input
            {...field}
            type="tel"
            ref={phoneFieldRef}
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
          />
        )}
      </Field>

      <Field id="enquiry-capture-source-field" label="Source">
        {(field) => (
          <Select
            {...field}
            value={source}
            onChange={(e) => onSource(e.target.value as CaptureSource)}
          >
            {CAPTURE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {locations.length > 1 ? (
        <Field id="enquiry-capture-location-field" label="Site">
          {(field) => (
            <Select
              {...field}
              value={locationId}
              onChange={(e) => onLocationId(e.target.value)}
              data-testid="enquiry-capture-location"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <Button
        variant="primary"
        size="md"
        onClick={onSubmit}
        disabled={busy || !fullName.trim() || !locationId}
        className="w-full"
        data-testid="enquiry-capture-submit"
      >
        {busy ? "Saving…" : "Capture enquiry"}
      </Button>

      {error ? (
        <p role="alert" className="text-[12px] text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
