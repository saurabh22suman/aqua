import type { KeyboardEventHandler } from "react";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

// The mobile field of the tenant entry.
//
// A real <label for> association rather than a wrapping label or a
// duplicated aria-label: the association is what makes the control
// announceable and tappable, and it lets the field carry a description
// of its own without the two fighting over the accessible name.
//
// The field keeps the platform's metrics: 16px text (so iOS does not
// zoom on focus) and the shared control-height token.

export type PhoneFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
};

export function PhoneField({
  id,
  value,
  onChange,
  onBlur,
  onKeyDown,
}: PhoneFieldProps) {
  const descriptionId = `${id}-description`;
  return (
    <div>
      <Label htmlFor={id}>Mobile number</Label>
      <p id={descriptionId} className="mt-1 text-[12px] text-balance text-ink-3">
        Any format works — 98765 43210 or +91 98765 43210. We add +91 for
        you.
      </p>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-describedby={descriptionId}
        aria-required="true"
        placeholder="+91 98765 43210"
        className="mt-1.5 min-h-[var(--control-height-lg)]"
      />
    </div>
  );
}
