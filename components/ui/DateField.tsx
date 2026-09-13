"use client";

import {
  useEffect,
  useId,
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
  "data-testid"?: string;
};

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
  "data-testid": testId,
}: DateFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [text, setText] = useState(() => isoToDisplay(value));

  // Sync from the canonical ISO prop only when it disagrees with what
  // the current text already means. Typing a partial date (which
  // emits "") must not reset the field mid-keystroke.
  useEffect(() => {
    setText((prev) =>
      (displayToIso(prev) ?? "") === (value ?? "") ? prev : isoToDisplay(value),
    );
  }, [value]);

  const complete = text.length === 10;
  const invalid = complete && displayToIso(text) === null;

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
        ref={inputRef}
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
        aria-invalid={invalid || undefined}
        className={`w-full rounded-ctl border px-3 py-2.5 text-[16px] ${
          tone === "deck" ? "bg-deck" : "bg-paper"
        } ${invalid ? "border-ink-2" : "border-line"} ${className}`}
        data-testid={testId}
      />
      {invalid ? (
        <p className="mt-1 text-[11.5px] text-ink-2">
          Enter a real date as dd/mm/yyyy.
        </p>
      ) : null}
    </div>
  );
}
