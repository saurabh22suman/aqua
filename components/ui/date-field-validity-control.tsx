"use client";

import { useEffect, useRef } from "react";

// The date field's COMPANION CONTROL.
//
// A read-only input is barred from constraint validation, so the field's
// own validity — a blank required date, a date that is not a real day —
// is carried here, where the browser's native check still sees it and
// `form.checkValidity()` refuses exactly as it did before.
//
// It is not a control anybody fills in: it is off the page's tab order
// and hidden from assistive technology.
//
// Its label is deliberately EMPTY. It is not a second date field for a
// reader, and a label of its own would answer to a query meant for the
// field the operator is actually filling in — two controls must never
// answer to the same name. The empty label keeps the control NAMED in
// the document (so no control in the form is left without one) without
// giving it a name of its own.

export function DateFieldValidityControl({
  id,
  value,
  required,
  disabled,
  message,
  onInvalid,
}: {
  id: string;
  /** The canonical date, or "" when the field holds none. */
  value: string;
  required?: boolean;
  /** A disabled field is not part of the form: it must not refuse it. */
  disabled?: boolean;
  /** The native message for the field's own invalid state, or "". */
  message: string;
  /** The browser refused the field: the field may now say what is wrong. */
  onInvalid?: () => void;
}) {
  const node = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = node.current;
    if (!input) return;
    input.setCustomValidity(message);
  }, [message]);

  return (
    <>
      <input
        ref={node}
        id={id}
        type="text"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        className="sr-only"
        value={value}
        required={required || undefined}
        // A disabled control is barred from constraint validation, so a
        // disabled required date does not refuse a form it is not part
        // of.
        disabled={disabled || undefined}
        onChange={() => {}}
        onInvalid={onInvalid}
      />
      <label htmlFor={id} className="sr-only" />
    </>
  );
}
