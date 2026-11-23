"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { IST_TIME_ZONE, parseCalendarDate } from "@/lib/time/calendar";
import {
  formatWallTime24hIST,
  todayInZone,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";

// The tenant entitlement deadline.
//
// The operator works in the console's own clock: the deadline is typed
// as a WALL time in IST (Asia/Kolkata) and the console converts it to
// the one canonical instant the service stores.
//
// Two fields, ONE value: the visible control is a plain date-and-time
// picker with no field name (it is a UI control, not a form field), and
// a hidden field named "expiresAt" carries the canonical UTC instant.
// The action and the service read "expiresAt" and nothing else, so
// exactly ONE expiresAt is ever posted.
//
// A deadline the operator does not touch is carried forward unchanged,
// seconds and milliseconds included: the hidden field starts on the
// stored instant and only moves when the operator picks a new time.

const WALL_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The IST wall time of an instant, in the shape the control takes. */
function istWallTime(instant: Date): string {
  const day = todayInZone(IST_TIME_ZONE, instant.getTime());
  return `${day}T${formatWallTime24hIST(instant)}`;
}

/**
 * The canonical instant of an IST wall time, or null when the value is
 * not a real date and time.
 *
 * The strict calendar parser does the day: 30 February is not a day,
 * and JavaScript would otherwise roll it over to 2 March.
 */
function istWallTimeToInstant(wallTime: string): string | null {
  const match = WALL_TIME_PATTERN.exec(wallTime);
  if (!match) return null;
  const [, day, hour, minute] = match;
  if (!parseCalendarDate(day)) return null;
  if (Number(hour) > 23 || Number(minute) > 59) return null;
  return zonedWallTimeToInstant(day, `${hour}:${minute}`, IST_TIME_ZONE).toISOString();
}

export function TenantExpiryField({
  id,
  label = "Expiry (optional)",
  initialValue,
  disabled = false,
}: {
  /** A DOM id, unique on the page — the label points at the input. */
  id: string;
  /** The field's visible name. The trial form names its own deadline. */
  label?: string;
  /** The stored deadline, when the tenant already has one. */
  initialValue?: Date;
  disabled?: boolean;
}) {
  const [canonical, setCanonical] = useState(() =>
    initialValue ? initialValue.toISOString() : "",
  );
  const [wallTime, setWallTime] = useState(() =>
    initialValue ? istWallTime(initialValue) : "",
  );
  const [invalid, setInvalid] = useState(false);

  function handleChange(next: string) {
    setWallTime(next);
    if (next === "") {
      // An emptied field is the CLEAR.
      setCanonical("");
      setInvalid(false);
      return;
    }
    const instant = istWallTimeToInstant(next);
    if (!instant) {
      // An impossible date or time never removes a stored deadline: the
      // instant that stands is kept and the operator is told.
      setInvalid(true);
      return;
    }
    setCanonical(instant);
    setInvalid(false);
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block">
        <span className="mb-1 block text-[12px] font-medium text-ink-2">
          {label}
        </span>
        <Input
          id={id}
          type="datetime-local"
          value={wallTime}
          onChange={(event) => handleChange(event.target.value)}
          aria-describedby={`${id}-hint`}
          invalid={invalid}
          disabled={disabled}
        />
      </label>
      {/* The canonical instant the service reads. Exactly one expiresAt. */}
      <input type="hidden" name="expiresAt" value={canonical} readOnly />
      <p id={`${id}-hint`} className="text-[12px] text-ink-3">
        Optional — leave it empty for no expiry. The time is read as IST
        (Asia/Kolkata).
      </p>
      {invalid ? (
        <p role="alert" className="text-[12px] text-ink-2">
          That is not a real date and time, so the expiry has not been changed.
        </p>
      ) : null}
    </div>
  );
}
