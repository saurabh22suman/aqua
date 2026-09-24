function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

// Reject ambiguous day/month values rather than guessing their locale.
export function parseImportDate(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const text = raw.trim();
  const iso = text.match(ISO_DATE);
  if (iso) {
    const [, y, m, d] = iso;
    if (isRealCalendarDate(Number(y), Number(m), Number(d))) {
      return { ok: true, value: text };
    }
    return { ok: false, reason: "That date does not exist." };
  }
  const dmy = text.match(DMY_DATE);
  if (dmy) {
    const [, d, m, y] = dmy;
    if (Number(d) <= 12) {
      return { ok: false, reason: "Ambiguous date — write it as YYYY-MM-DD." };
    }
    if (!isRealCalendarDate(Number(y), Number(m), Number(d))) {
      return { ok: false, reason: "That date does not exist." };
    }
    return { ok: true, value: `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}` };
  }
  return { ok: false, reason: "Use a YYYY-MM-DD date." };
}
