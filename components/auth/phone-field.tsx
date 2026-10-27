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
        Enter your 10-digit mobile number
      </p>
      <div className="relative mt-1.5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 z-10 text-[16px] text-ink-2"
          style={{ top: "50%", transform: "translateY(-50%)" }}
        >
          +91
        </span>
        <Input
          id={id}
          value={value.replace(/^\+91[\s-]*/, "")}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-describedby={descriptionId}
          aria-required="true"
          placeholder="98765 43210"
          className="min-h-[var(--control-height-lg)]"
          style={{ paddingInlineStart: "3.5rem" }}
        />
      </div>
    </div>
  );
}
