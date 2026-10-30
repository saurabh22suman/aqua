"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
} from "react";

// 2026-09-13 UI/UX audit §7.3 — the native date input ignores its
// `lang`/placeholder and renders US mm/dd/yyyy segment labels on this
// device locale, silently storing a month-first value for a day-first
// intent. On a minor's DOB that gates the guardian-consent flow, a
// day ≤ 12 typed first produced the wrong date with no error.
//
// This is the masked dd/mm/yyyy field the audit asked for: a numeric
// text input, day-first by construction, whose value is emitted as an
// ISO `yyyy-mm-dd` string so no caller has to know about the display
// format. Invalid complete dates (31/02/…) never emit and set
// aria-invalid so the surrounding form can show its own message.
//
// Owner redesign (27 October 2026) — the date field is the product's
// DATE PICKER, so it wears the standard control metrics (48px, the 10px
// control radius, 16px control text) and the very lightly tinted picker
// surface: a date is a choice, and it should not read as free text.

export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function displayToIso(display: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Progressive dd/mm/yyyy mask: digits only, slashes inserted after
// the day and month, capped at 8 digits.
function maskDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i === 2 || i === 4) out += "/";
    out += digits[i];
  }
  return out;
}

export type DateFieldProps = {
  value: string;
  onChange: (iso: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  // Optional handle on the underlying input (auto-focus on inline edit).
  inputRef?: Ref<HTMLInputElement>;
  // Surfaces that sit inside a paper card use the default paper input;
  // the enquiry capture card is deck-toned, so its fields are too.
  tone?: "paper" | "deck";
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  required?: boolean;
  /**
   * The persistent day-first guidance. Visible by default; an inline
   * editor may keep it screen-reader-only, and a caller that already
   * renders equivalent persistent guidance may opt out. It is never
   * conveyed by the disappearing placeholder alone.
   */
  formatHint?: "visible" | "sr-only" | "none";
  "data-testid"?: string;
  /**
   * Reports the field's validity for an imperative submit button.
   *
   * A fully blank optional date is valid. Nonempty partial text, an
   * impossible date and a blank required date are invalid. Native forms
   * get the same answer from `required` plus the input's custom validity,
   * so `form.checkValidity()` refuses it. Keep this boolean in the
   * consumer's disabled/guard state; never turn an invalid visible date
   * into a deliberate blank.
   */
  onValidityChange?: (valid: boolean) => void;
};

function assignRef(
  ref: Ref<HTMLInputElement> | undefined,
  node: HTMLInputElement | null,
) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
}

export function DateField({
  value,
  onChange,
  onBlur,
  onKeyDown,
  id,
  placeholder = "dd/mm/yyyy",
  className = "",
  disabled,
  inputRef,
  tone = "paper",
  "aria-label": ariaLabel,
  "aria-describedby": describedByProp,
  "aria-invalid": ariaInvalidProp,
  "aria-required": ariaRequiredProp,
  required = false,
  formatHint = "visible",
  "data-testid": testId,
  onValidityChange,
}: DateFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const formatId = `${inputId}-format`;
  const internalErrorId = `${inputId}-date-error`;
  const [text, setText] = useState(() => isoToDisplay(value));
  const inputNode = useRef<HTMLInputElement | null>(null);
  const lastValid = useRef<boolean | null>(null);

  // Sync from the canonical ISO prop only when it disagrees with what
  // the current text already means. Typing a partial date (which
  // emits "") must not reset the field mid-keystroke.
  useEffect(() => {
    setText((prev) =>
      (displayToIso(prev) ?? "") === (value ?? "") ? prev : isoToDisplay(value),
    );
  }, [value]);

  const complete = text.length === 10;
  const completeInvalid = complete && displayToIso(text) === null;
  const empty = text.length === 0;
  const incomplete = !empty && !complete;
  const missingRequired = Boolean((required || ariaRequiredProp) && empty);
  // The visible error stays on a complete impossible date; partial text is
  // invalid for submission without turning the field into an error while
  // the reader is still typing.
  const invalid = completeInvalid;
  const valid = !(
    incomplete ||
    completeInvalid ||
    missingRequired ||
    ariaInvalidProp
  );

  useEffect(() => {
    const input = inputNode.current;
    if (!input) return;
    input.setCustomValidity(
      incomplete || completeInvalid
        ? "Enter a real date in DD/MM/YYYY format."
        : "",
    );
  }, [completeInvalid, incomplete]);

  useEffect(() => {
    if (lastValid.current === valid) return;
    lastValid.current = valid;
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  const describedBy = Array.from(
    new Set(
      [
        describedByProp,
        formatHint === "none" ? null : formatId,
        invalid ? internalErrorId : null,
      ]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.split(/\s+/)),
    ),
  ).join(" ") || undefined;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Pasting (or a programmatic set of) an ISO date should work like a
    // paste, not be re-read as day-first digits.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const iso = displayToIso(isoToDisplay(raw));
      if (iso) {
        setText(isoToDisplay(iso));
        onChange(iso);
        return;
      }
    }
    const masked = maskDisplay(raw);
    setText(masked);
    onChange(displayToIso(masked) ?? "");
  }

  return (
    <div>
      <input
        ref={(node) => {
          inputNode.current = node;
          assignRef(inputRef, node);
        }}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={10}
        value={text}
        onChange={handleChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || ariaInvalidProp || undefined}
        aria-required={ariaRequiredProp || required || undefined}
        required={required || ariaRequiredProp || undefined}
        className={`w-full min-h-12 rounded-ctl border px-4 py-2.5 text-[16px] ${
          tone === "deck" ? "bg-deck" : "bg-[var(--control-surface-picker)]"
        } ${invalid ? "border-ink-2" : "border-[var(--control-border)]"} ${className}`}
        data-testid={testId}
      />
      {formatHint !== "none" ? (
        <p
          id={formatId}
          className={
            formatHint === "sr-only"
              ? "sr-only"
              : "mt-1 text-[11.5px] text-ink-3"
          }
        >
          Format: DD/MM/YYYY
        </p>
      ) : null}
      {invalid ? (
        <p
          id={internalErrorId}
          role="alert"
          className="mt-1 text-[11.5px] text-ink-2"
        >
          Enter a real date in DD/MM/YYYY format.
        </p>
      ) : null}
    </div>
  );
}
