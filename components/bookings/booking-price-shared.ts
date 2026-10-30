// Batch 6 — shared bits of the booking price editor.
//
// The day numbers are the schema's own: booking_price_rules.days_of_week
// stores 0 = Sunday (it matches JS getDay and lib/time/tz weekdayOf).
// The labels are shown Monday-first because that is how an owner reads
// a week; the VALUES never change.

import { formatWallTime12h } from "@/lib/time/tz";

export type PriceFacilityOption = {
  id: string;
  name: string;
  locationName: string;
};

export const PRICE_DAY_CHOICES: ReadonlyArray<{
  value: number;
  label: string;
}> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

// Exact inverse of the server's rupees → paise conversion: the paise
// always show when they are not zero.
export function paiseToRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, "0")}`;
}

export function daySummary(days: number[]): string {
  if (days.length === 0) return "Every day";
  return PRICE_DAY_CHOICES.filter((day) => days.includes(day.value))
    .map((day) => day.label)
    .join(", ");
}

export function windowSummary(
  startTime: string | null,
  endTime: string | null,
): string {
  if (!startTime && !endTime) return "All day";
  const start = formatWallTime12h(startTime ?? "00:00");
  if (!endTime || endTime === "24:00") {
    // The window runs to the end of that day: the next midnight. The
    // label says so the way the calendar says it.
    return `${start}–${formatWallTime12h("00:00")} (+1d)`;
  }
  return `${start}–${formatWallTime12h(endTime)}`;
}
