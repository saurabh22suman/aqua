// The shared owner calendar — event model.
//
// Two owner surfaces use this composition: the schedule (batch
// sessions) and the booking desk (bookings). The model therefore
// carries only what BOTH can answer. Everything the calendar cannot
// know for itself — the tenant's vocabulary, the capacity meaning, the
// detail rows — is supplied by the calling surface, so the calendar
// stays a layout and interaction concern rather than a domain one.
//
// Category tint: a batch and a booking are told apart by a stable,
// subtle surface pair AND by an explicit word and icon. Colour is
// never the only cue (DESIGN.md §3). The two surfaces are the
// theme's own restrained tints, so they follow the active preset.

export type CalendarCategory = "batch" | "booking";

export type CalendarEvent = {
  id: string;
  category: CalendarCategory;
  /** Short name shown on the block and in the agenda. */
  title: string;
  /** The calendar day the event belongs to, yyyy-mm-dd in the display zone. */
  date: string;
  /** ISO instant. */
  startsAt: string;
  /** ISO instant. */
  endsAt: string;
  /** Minutes from midnight in the display zone. */
  startMinutes: number;
  /** Length in minutes. */
  durationMinutes: number;
  /** Lifecycle state. Kept separate from the category tint. */
  status: string;
  /** Optional fill bar (capacity). The owning surface decides the class. */
  capacityFillClass?: string | null;
  capacityLabel?: string | null;
  /** How full the bar is, 0-100. */
  capacityPercent?: number | null;
  /** Where it happens — a coach, a location, a member. */
  resourceLabel?: string | null;
  /** Rows shown in the detail panel. */
  detail: ReadonlyArray<{ label: string; value: string }>;
  /** Deep link to the owning record. */
  href?: string | null;
  /**
   * Identifies the resource two events would really clash over (the
   * coach who cannot be in two places, the court that cannot host two
   * games). Two events are only in conflict when they share it —
   * simple simultaneity on different resources is not a conflict.
   */
  resourceKey?: string | null;
};

export type CalendarGeometry = {
  /** First minute of the visible day, counted from midnight. */
  dayStartMinutes: number;
  /** Last minute of the visible day. */
  dayEndMinutes: number;
  /** Pixels per minute. */
  pixelsPerMinute: number;
};

/** The counter's working day: 06:00 to 22:00, the booking slot window. */
export const DEFAULT_GEOMETRY: CalendarGeometry = {
  dayStartMinutes: 6 * 60,
  dayEndMinutes: 22 * 60,
  pixelsPerMinute: 1,
};

export const CATEGORY_TINT_CLASS: Record<CalendarCategory, string> = {
  batch: "border-l-[var(--accent-strong)] bg-[var(--accent-soft)]",
  booking: "border-l-[var(--color-ink-2)] bg-[var(--tint-butter)]",
};

export const CATEGORY_ICON_NAME: Record<CalendarCategory, string> = {
  batch: "calendar",
  booking: "ticket",
};

/**
 * Lifecycle words. These are the same words the rest of the product
 * uses, so a reader never has to learn a second vocabulary. A state is
 * always spelled out — the tint is a supporting cue, never the message.
 */
export const EVENT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  held: "Held",
  confirmed: "Confirmed",
};

export function eventStatusLabel(status: string): string {
  return EVENT_STATUS_LABEL[status] ?? status;
}

/** A cancelled event is drawn dashed and quiet; it never looks live. */
export function isCancelled(status: string): boolean {
  return status === "cancelled";
}

export type PlacedCalendarEvent = {
  event: CalendarEvent;
  /** Pixels from the top of the day's track. */
  top: number;
  /** Height in pixels, proportional to the real duration. */
  height: number;
  /** Overlap column, 0-based. */
  column: number;
  /** How many columns this event's overlap cluster uses. */
  columns: number;
  /** True when the event really clashes with another on the same resource. */
  clash: boolean;
};
