"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days.mjs";
import { DateCalendar } from "./DateCalendar";
import { DateFieldValidityControl } from "./date-field-validity-control";
import { assignRef, type DateFieldProps } from "./date-field-props";
import { dateFieldState } from "./date-field-state";
import { useDateCalendar } from "./use-date-calendar";
import {
  displayToIso,
  isoToDisplay,
  maskDisplay,
  parseCalendarDate,
  todayCalendarDate,
} from "@/lib/time/calendar";

// 2026-09-13 UI/UX audit §7.3 — the native date input ignores its
// `lang`/placeholder and renders US mm/dd/yyyy segment labels on this
// device locale, silently storing a month-first value for a day-first
// intent. On a minor's DOB that gates the guardian-consent flow, a
// day ≤ 12 typed first produced the wrong date with no error.
//
// The masked dd/mm/yyyy field answered that. The 31 October 2026
// revision answers it better: a date is a CHOICE, so the field is now
// the product's DATE PICKER — a read-only display of the chosen date
// and an app-styled month calendar (components/ui/DateCalendar.tsx).
// The value is still the canonical `yyyy-mm-dd` and the display is
// still DD/MM/YYYY, so no consumer changes.
//
// THE READ-ONLY FIELD AND NATIVE VALIDATION. A read-only input is
// barred from constraint validation, so `required` on it would stop
// meaning anything: the field's own companion control carries the
// validity instead, and `form.checkValidity()` still refuses a blank
// required date exactly as before.
//
// THE MASK REMAINS for PROGRAMMATIC values: the shared parser
// (`displayToIso`) and its invalid/leap behaviour are part of this
// component's exported contract, and a value set on the control by
// code still resolves through it. A person cannot type into the
// control — it is read-only.

export { displayToIso, isoToDisplay } from "@/lib/time/calendar";
export type { DateFieldProps } from "./date-field-props";

/** The keys that OPEN the calendar, and belong to the field alone. */
function opensTheCalendar(event: KeyboardEvent<HTMLInputElement>): boolean {
  if (event.key === "Enter" || event.key === " ") return true;
  if (event.key !== "ArrowDown") return false;
  return true;
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
  formatHint = "sr-only",
  calendarLabel = "Choose date",
  "data-testid": testId,
  onValidityChange,
}: DateFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const formatId = `${inputId}-format`;
  const internalErrorId = `${inputId}-date-error`;
  const [text, setText] = useState(() => isoToDisplay(value));
  const [attempted, setAttempted] = useState(false);
  const inputNode = useRef<HTMLInputElement | null>(null);
  const lastValid = useRef<boolean | null>(null);
  const calendar = useDateCalendar({
    disabled,
    inputRef: inputNode,
    onBlur,
    calendarId: `${inputId}-calendar`,
  });

  // Sync from the canonical ISO prop only when it disagrees with what
  // the current text already means. A partial value (which emits "")
  // must not reset the field mid-entry.
  useEffect(() => {
    setText((prev) =>
      (displayToIso(prev) ?? "") === (value ?? "") ? prev : isoToDisplay(value),
    );
  }, [value]);

  const {
    incomplete,
    impossible: completeInvalid,
    invalid,
    valid,
    errorText,
  } = dateFieldState({
    text,
    required: Boolean(required || ariaRequiredProp),
    attempted,
    callerInvalid: ariaInvalidProp,
  });

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

  function handleSelect(iso: string) {
    onChange(iso);
    calendar.closeCalendar(true);
  }

  function handleClear() {
    onChange("");
    calendar.closeCalendar(true);
  }

  /**
   * The keys that open the calendar are the FIELD's, and they are
   * handled before the consumer hears them: an enclosing editor that
   * commits on Enter must not write the old value while the reader is
   * choosing a date. Every other key (Escape above all) still reaches
   * the consumer.
   */
  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!calendar.open && opensTheCalendar(event)) {
      event.preventDefault();
      event.stopPropagation();
      calendar.openCalendar();
      return;
    }
    onKeyDown?.(event);
  }

  /** The browser refused the field: say what is wrong, and take the focus. */
  function handleInvalid() {
    setAttempted(true);
    inputNode.current?.focus();
  }

  const canonical = parseCalendarDate(value) ? value : "";

  return (
    <div
      className="relative"
      ref={calendar.wrapperRef}
      onBlur={calendar.handleWrapperBlur}
    >
      <div className="flex items-stretch gap-2">
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
          readOnly
          // The value and the 44px icon beside it need room: the field's
          // own minimum is small, so a caller's own minimum is never
          // fought by a zero minimum of ours.
          size={1}
          value={text}
          onChange={handleChange}
          onClick={() => calendar.openCalendar()}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid || ariaInvalidProp || undefined}
          aria-required={ariaRequiredProp || required || undefined}
          required={required || ariaRequiredProp || undefined}
          className={`w-full flex-1 min-h-12 rounded-ctl border px-4 py-2.5 text-[16px] ${
            tone === "deck" ? "bg-deck" : "bg-[var(--control-surface-picker)]"
          } ${invalid ? "border-ink-2" : "border-[var(--control-border)]"} ${className}`}
          data-testid={testId}
        />
        <button
          type="button"
          ref={calendar.triggerRef}
          onClick={() =>
            calendar.open
              ? calendar.closeCalendar(true)
              : calendar.openCalendar()
          }
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={calendar.open}
          aria-label={calendarLabel}
          className={`flex min-h-11 w-11 shrink-0 items-center justify-center self-stretch rounded-ctl border text-ink-2 ${
            tone === "deck" ? "bg-deck" : "bg-[var(--control-surface-picker)]"
          } ${invalid ? "border-ink-2" : "border-[var(--control-border)]"}`}
        >
          <CalendarDays size={18} aria-hidden="true" />
        </button>
      </div>
      <DateFieldValidityControl
        id={`${inputId}-validity`}
        value={canonical}
        required={required || ariaRequiredProp}
        disabled={disabled}
        message={
          incomplete || completeInvalid
            ? "Enter a real date in DD/MM/YYYY format."
            : ""
        }
        onInvalid={handleInvalid}
      />
      {calendar.open && calendar.anchor ? (
        <DateCalendar
          id={`${inputId}-calendar`}
          value={value}
          todayIso={todayCalendarDate()}
          onSelect={handleSelect}
          onClear={required || ariaRequiredProp ? undefined : handleClear}
          onDismiss={() => calendar.closeCalendar(true)}
          anchor={calendar.anchor}
          popupRef={calendar.popupRef}
        />
      ) : null}
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
      {errorText ? (
        <p
          id={internalErrorId}
          role="alert"
          className="mt-1 text-[11.5px] text-ink-2"
        >
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
