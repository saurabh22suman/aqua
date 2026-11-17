"use client";

import { displayToIso } from "@/lib/time/calendar";

// The date field's STATE.
//
// The field answers three questions at once: is the value a whole date,
// is it a day the calendar has, and is a required date missing. They
// are one pure function so that the field, its companion control and
// the visible error can never disagree about what the field holds.

export type DateFieldState = {
  /** The field holds no date at all. */
  empty: boolean;
  /** The text is not a whole date. */
  incomplete: boolean;
  /** The text is a whole date that is not a day the calendar has. */
  impossible: boolean;
  /** A required field holds no date. */
  missingRequired: boolean;
  /** The field shows an error now. */
  invalid: boolean;
  /** The field's own validity: what `onValidityChange` reports. */
  valid: boolean;
  /** What the field says when it shows an error. */
  errorText: string;
};

export function dateFieldState({
  text,
  required,
  attempted,
  callerInvalid,
}: {
  /** What the field shows: the day-first display of its value. */
  text: string;
  /** The field must hold a date. */
  required: boolean;
  /** The browser has refused the field at least once. */
  attempted: boolean;
  /** The caller says the value is wrong. */
  callerInvalid?: boolean;
}): DateFieldState {
  const complete = text.length === 10;
  const empty = text.length === 0;
  const incomplete = !empty && !complete;
  const impossible = complete && displayToIso(text) === null;
  const missingRequired = required && empty;
  // The visible error stays on an impossible date, and it appears on a
  // blank required date only once the browser has refused it: an
  // untouched field does not announce a mistake nobody made.
  const invalid = impossible || (missingRequired && attempted);
  const valid = !(
    incomplete ||
    impossible ||
    missingRequired ||
    callerInvalid
  );
  const errorText = impossible
    ? "That date does not exist."
    : missingRequired && attempted
      ? "Choose a date."
      : "";
  return {
    empty,
    incomplete,
    impossible,
    missingRequired,
    invalid,
    valid,
    errorText,
  };
}
