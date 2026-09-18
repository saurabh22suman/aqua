// V-04 — shared booking-form constants. The counter offers hourly
// slots from 06:00 to 21:00 (the last booking ends at 22:00); the
// grid is fixed in R1, independent of business hours, which drive the
// utilisation report rather than the walk-in form.

export const SLOT_STARTS = Array.from({ length: 16 }, (_, index) => {
  const hour = 6 + index;
  return `${String(hour).padStart(2, "0")}:00`;
});

export function slotEnd(slotStart: string): string {
  const [hour, minute] = slotStart.split(":").map(Number);
  const end = (hour! + 1) % 24;
  return `${String(end).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
}
