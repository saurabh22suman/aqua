// Owner Home — the greeting.
//
// The approved mock opens Home with a time-of-day greeting and the club's own
// date. No personal name is used: the authorised Owner context carries none
// (lib/auth/context.ts), and inventing one — or adding an identity read just
// for the copy — is out of scope. The word is computed from the club's display
// timezone (the same zone the rest of the app prints times in), so it is TRUE
// rather than a fixed string.

export const OWNER_DISPLAY_TIME_ZONE = "Asia/Kolkata";

export type OwnerGreeting =
  | "Hello"
  | "Good morning"
  | "Good afternoon"
  | "Good evening";

/** The greeting word for an instant, in the club's display timezone. */
export function greetingFor(now: Date = new Date()): OwnerGreeting {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: OWNER_DISPLAY_TIME_ZONE,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  // Before 04:00 the day has not started for anyone: greet the person who
  // is opening the club, never "Good night" (a farewell).
  if (hour >= 4 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Hello";
}
