const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** A timestamp, or an honest dash when there is none to show. */
export function operatorTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${DATE_FMT.format(date)} IST`;
}

/**
 * The short form of an identifier, for a row that shows one.
 *
 * The full value stays in the element's title attribute, so an
 * operator can still copy it — a truncated identifier on its own would
 * be a reference nobody can use.
 */
export function shortOperatorId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
