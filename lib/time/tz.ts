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
