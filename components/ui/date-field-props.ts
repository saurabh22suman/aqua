"use client";

import type { KeyboardEvent, Ref } from "react";

// The shared date field's PROPERTIES.
//
// The API is the product's: the canonical value in, the canonical value
// out, the caller's label, the caller's ref, the caller's validity
// callback. Nothing here is new except the calendar's accessible name,
// which a surface with more than one date on screen uses to tell the
// two apart.

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
   * The persistent day-first guidance. Screen-reader-only by default —
   * the date is chosen from a calendar, so a visible paragraph about
   * typing would teach something nobody does any more. A caller that
   * wants it visible, or hidden entirely, says so.
   */
  formatHint?: "visible" | "sr-only" | "none";
  /**
   * The accessible name of the control that opens the calendar. It
   * defaults to "Choose date"; a surface with more than one date on
   * screen names them apart, so two buttons never answer to the same
   * name.
   */
  calendarLabel?: string;
  "data-testid"?: string;
  /**
   * Reports the field's validity for an imperative submit button.
   *
   * A fully blank optional date is valid. A date that is not a real
   * calendar day and a blank required date are invalid. Native forms
   * get the same answer from the field's own companion control, so
   * `form.checkValidity()` refuses it. Keep this boolean in the
   * consumer's disabled/guard state; never turn an invalid visible date
   * into a deliberate blank.
   */
  onValidityChange?: (valid: boolean) => void;
};

export function assignRef(
  ref: Ref<HTMLInputElement> | undefined,
  node: HTMLInputElement | null,
) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
}
