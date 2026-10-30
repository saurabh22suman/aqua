"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FieldError } from "./FieldError";
import { Select } from "./Select";
import { cn } from "./cn";

// Shared 12-hour time control.
//
// The stored/emitted value is always canonical 24-hour `HH:mm` (or "" for
// empty/partial/invalid). The visible controls are explicit native selects
// for hour, minutes and AM/PM, so the field has one understandable group and
// does not depend on a locale-native time picker. No calendar, widget or
// dependency; no booking interval is imposed (minutes 00..59).
//
// Existing time inputs are controlled `value`/`onChange` fields without
// min/max/step. This API intentionally does not accept those constraints;
// migrating a consumer that relies on them requires an explicit API decision
// rather than silently dropping the constraint.

export type TimeFieldProps = {
  id: string;
  label: string;
  /** Canonical 24-hour HH:mm, or "". */
  value: string;
  /** Emits canonical HH:mm or "" when the visible entry is partial/invalid. */
  onChange: (value: string) => void;
  name?: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  hourLabel?: string;
  minuteLabel?: string;
  periodLabel?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  "data-testid"?: string;
  /**
   * Optional validity notification for a consumer whose submit button is
   * imperative (not a native form submit). Native-form consumers are already
   * covered by the conditional required controls; guard imperative submit on
   * this boolean and call form.reportValidity() where available.
   */
  onValidityChange?: (valid: boolean) => void;
};

type Parts = { hour: string; minute: string; period: "" | "AM" | "PM" };
const EMPTY: Parts = { hour: "", minute: "", period: "" };

function parseCanonical(value: string): Parts | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  return {
    hour: String(hours % 12 || 12),
    minute: match[2]!,
    period: hours < 12 ? "AM" : "PM",
  };
}

function canonical(parts: Parts): string {
  if (!parts.hour || !parts.minute || !parts.period) return "";
  let hours = Number(parts.hour) % 12;
  if (parts.period === "PM") hours += 12;
  return `${String(hours).padStart(2, "0")}:${parts.minute}`;
}

export function TimeField({
  id,
  label,
  value,
  onChange,
  name,
  description,
  error,
  required = false,
  disabled = false,
  className,
  hourLabel = "Hour",
  minuteLabel = "Minutes",
  periodLabel = "AM/PM",
  "aria-describedby": describedByProp,
  "aria-invalid": ariaInvalidProp,
  "aria-required": ariaRequiredProp,
  "data-testid": testId,
  onValidityChange,
}: TimeFieldProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const [parts, setParts] = useState<Parts>(() => parseCanonical(value) ?? EMPTY);
  const helpId = `${fieldId}-help`;
  const descriptionId = description ? `${fieldId}-description` : null;
  const errorId = error ? `${fieldId}-error` : null;
  const complete = Boolean(parts.hour && parts.minute && parts.period);
  const hasAnyPart = Boolean(parts.hour || parts.minute || parts.period);
  const invalidCanonical = value !== "" && !parseCanonical(value);
  const missingRequired = Boolean((required || ariaRequiredProp) && !complete);
  const invalid = Boolean(
    error ||
      ariaInvalidProp ||
      invalidCanonical ||
      (hasAnyPart && !complete) ||
      missingRequired,
  );
  const valid = !invalid;
  // A partial optional entry must not look like an intentional all-day blank.
  // Native required controls make form.checkValidity()/submit refuse it.
  const nativeRequired = Boolean(
    required ||
      ariaRequiredProp ||
      hasAnyPart ||
      invalidCanonical ||
      error ||
      ariaInvalidProp,
  );
  const lastValid = useRef<boolean | null>(null);

  useEffect(() => {
    setParts((previous) => {
      if (value === "") {
        // A parent reset from a complete value clears the group. A partial
        // selection already emits ""; keep those visible parts so the reader
        // can finish choosing.
        return canonical(previous) ? EMPTY : previous;
      }
      const parsed = parseCanonical(value);
      if (!parsed) return EMPTY;
      return canonical(previous) === value ? previous : parsed;
    });
  }, [value]);

  useEffect(() => {
    if (lastValid.current === valid) return;
    lastValid.current = valid;
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  const describedBy =
    [
      describedByProp,
      descriptionId,
      helpId,
      errorId,
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.split(/\s+/))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .join(" ") || undefined;

  function select(part: keyof Parts, next: string) {
    if (disabled) return;
    const updated = { ...parts, [part]: next } as Parts;
    setParts(updated);
    onChange(canonical(updated));
  }

  const requiredMarker = required || ariaRequiredProp ? (
    <>
      <span aria-hidden="true" className="ml-1 text-ink-3">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  ) : null;

  return (
    <fieldset
      id={fieldId}
      data-testid={testId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || ariaRequiredProp || undefined}
      disabled={disabled}
      className={cn("min-w-0", className)}
    >
      <legend className="text-[13px] font-medium text-ink-2">
        {label}
        {requiredMarker}
      </legend>
      {description ? (
        <p id={descriptionId ?? undefined} className="mt-1 text-[12px] text-ink-3">
          {description}
        </p>
      ) : null}
      <p id={helpId} className="mt-1 text-[12px] text-ink-3">
        Choose hour, minutes and AM/PM.
      </p>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.85fr)] gap-2">
        <label htmlFor={`${fieldId}-hour`} className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-3">{hourLabel}</span>
          <Select
            id={`${fieldId}-hour`}
            value={parts.hour}
            onChange={(event) => select("hour", event.target.value)}
            disabled={disabled}
            required={nativeRequired}
            aria-label={hourLabel}
          >
            <option value="">—</option>
            {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => (
              <option key={hour} value={hour}>
                {hour}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={`${fieldId}-minute`} className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-3">{minuteLabel}</span>
          <Select
            id={`${fieldId}-minute`}
            value={parts.minute}
            onChange={(event) => select("minute", event.target.value)}
            disabled={disabled}
            required={nativeRequired}
            aria-label={minuteLabel}
          >
            <option value="">—</option>
            {Array.from({ length: 60 }, (_, index) =>
              String(index).padStart(2, "0"),
            ).map((minute) => (
              <option key={minute} value={minute}>
                {minute}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={`${fieldId}-period`} className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-3">{periodLabel}</span>
          <Select
            id={`${fieldId}-period`}
            value={parts.period}
            onChange={(event) => select("period", event.target.value)}
            disabled={disabled}
            required={nativeRequired}
            aria-label={periodLabel}
          >
            <option value="">—</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </Select>
        </label>
      </div>
      {error ? <FieldError id={errorId ?? undefined}>{error}</FieldError> : null}
      {name ? (
        <input
          type="hidden"
          name={name}
          value={parseCanonical(value) ? value : ""}
          disabled={disabled}
          data-testid={testId ? `${testId}-value` : undefined}
        />
      ) : null}
    </fieldset>
  );
}
