const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function partsInZone(instant: number, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

export function todayInZone(timeZone: string, now = Date.now()): string {
  const { year, month, day } = partsInZone(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return YMD.format(new Date(t));
}

// A display window anchored on "today" in a tenant's timezone. Used by
// /owner/sessions (14 days). Deriving the anchor from UTC
// (`toISOString().slice(0, 10)`) was P0-3 residue: between 00:00 and
// 05:30 IST the UTC date is still yesterday, so the window included
// sessions that had already run.
export function daysAheadWindow(
  timeZone: string,
  days: number,
  now = Date.now(),
): { fromDate: string; toDate: string } {
  const fromDate = todayInZone(timeZone, now);
  return { fromDate, toDate: addDays(fromDate, days) };
}

export function weekdayOf(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function zonedWallTimeToInstant(
  dateIso: string,
  wallTime: string,
  timeZone: string,
): Date {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const [hh, mm] = wallTime.split(":").map(Number);

  let guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(guess, timeZone);
    const asZone = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = asZone - guess;
    guess = Date.UTC(y, mo - 1, d, hh, mm, 0) - offset;
  }
  return new Date(guess);
}

export function isMinor(
  dateOfBirth: string | null | undefined,
  timeZone: string,
  now = Date.now(),
): boolean {
  if (dateOfBirth == null) {
    throw new Error(
      "isMinor: date of birth is required to determine minor status — refusing to guess",
    );
  }
  const today = todayInZone(timeZone, now);
  const [ty, tm, td] = today.split("-").map(Number);
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age < 18;
}

// Display formatters. The canonical zone for this product is
// Asia/Kolkata; callers that need another zone should build their own
// Intl call rather than growing this API until a second zone exists.
// `en-IN` gives the Indian conventions the audit asked for:
// "05:00 pm" (12-hour, lowercase meridiem) and "12 Sept 2026"
// (unambiguous day-month-year, never 12/09/2026).

export function formatDateIST(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function formatTimeIST(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export function formatDateTimeIST(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${formatDateIST(d)}, ${formatTimeIST(d)}`;
}

export function formatWeekdayDateIST(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

// A wall-clock time from a `time` column ("07:00:00") or an input value
// ("07:00"). Not an instant, so no zone conversion: the value is
// already the academy's local time. Unknown shapes pass through, same
// contract as formatPhoneIN.
export function formatWallTime12h(wall: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(wall);
  if (!match) return wall;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return wall;
  const d = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}
