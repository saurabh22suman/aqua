import type { KeyboardEventHandler } from "react";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import { FieldError } from "@/components/ui/FieldError";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

// The PIN field of the tenant entry.
//
// The PIN stays masked by default and the reveal is an explicit,
// labelled control the caller owns. The toggle is a real
// <button type="button">, so it never submits the form, and it names
// the field it controls.
//
// The rule (6 to 12 digits) is stated under the label, and when the
// field is left with an unusable PIN the error sits beside the control
// and is announced — never in a summary at the top of the page.

export type PinFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  revealed: boolean;
  onToggleRevealed: () => void;
  invalid?: boolean;
  error?: string;
};

export function PinField({
  id,
  value,
  onChange,
  onBlur,
  onKeyDown,
  revealed,
  onToggleRevealed,
  invalid = false,
  error,
}: PinFieldProps) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [descriptionId, invalid ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <Label htmlFor={id}>PIN</Label>
      <p id={descriptionId} className="mt-1 text-[12px] text-ink-3">
        6 to 12 digits.
      </p>
      <div className="relative mt-1.5">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          type={revealed ? "text" : "password"}
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={12}
          aria-describedby={describedBy}
          aria-required="true"
          invalid={invalid}
          placeholder="••••••"
          className="min-h-[var(--control-height-lg)] pr-14 text-[20px] font-display tracking-[0.3em]"
        />
        <button
          type="button"
          onClick={onToggleRevealed}
          aria-controls={id}
          aria-label={revealed ? "Hide PIN" : "Show PIN"}
          title={revealed ? "Hide PIN" : "Show PIN"}
          className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-ctl text-ink-2 motion-fast hover:bg-deck"
        >
          {revealed ? (
            <EyeOff size={18} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Eye size={18} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </div>
      {invalid && error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
