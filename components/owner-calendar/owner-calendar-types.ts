// The shared owner calendar — the shared prop types.
//
// Kept in their own file so the calendar's controls and the calendar
// itself agree on one definition of "a navigation target" without
// importing each other.

/** A navigation target is a link (server-driven) or a callback (client-driven). */
export type CalendarNavTarget = { href: string } | { onSelect: () => void };
