// The console's formatting helpers.
//
// The zone is NAMED, not inherited: the deployed container runs in UTC,
// and an inherited zone rendered a trail in the wrong clock (the same
// staging finding the ops activity list records). Every timestamp on
// this console is read in Asia/Kolkata and says so.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** A timestamp, or an honest dash when there is none to show. */
export function recoveryTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${DATE_FMT.format(date)} IST`;
}

/**
 * The short form of an identifier, for a row that shows one.
 *
 * The full value stays in the element's title attribute, so an operator
 * can still copy it — a truncated identifier on its own would be a
 * reference nobody can use.
 */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
