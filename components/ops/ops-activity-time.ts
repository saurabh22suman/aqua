// Ops redesign (28 October 2026) — the activity filter's TIME model.
//
// The pure part of the activity filter, separated from its rendering:
// the IST conversions, the relative ranges, and the query it builds.
//
// It is pure on purpose. The rendering is a client island whose
// behaviour is hard to assert in a browser and easy to assert here:
// an instant in, an instant out, and the query that carries it.
//
// THE TIME ZONE. Asia/Kolkata has no daylight saving, so its offset is
// a fixed +05:30. The operator works in that zone, so the controls show
// IST and the query carries an offset-aware IST timestamp — the
// backend's date filter is unchanged and compares it against
// `created_at` exactly as it always did.
//
// No date library is added: the conversions are the platform's own
// Intl.DateTimeFormat, which is the same rule the rest of the product
// follows (explicit zone, never a hand-rolled locale string).

/** Asia/Kolkata's fixed offset. */
export const IST_OFFSET = "+05:30";

export const RANGE_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
] as const;

/** The hours a relative range covers. */
export const RANGE_HOURS: Record<string, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

const IST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The IST date and time of an instant, for the date and time inputs. */
export function formatIstParts(iso: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = IST_FORMATTER.formatToParts(at);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${pick("hour")}:${pick("minute")}:${pick("second")}`,
  };
}

/** The offset-aware IST timestamp for a date and a time. */
export function buildIstTimestamp(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const normalized = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalized}${IST_OFFSET}`;
}

/** The instants a relative range covers. */
export function activityRangeBounds(
  range: string,
  now: Date = new Date(),
): { since: string; until: string } | null {
  const hours = RANGE_HOURS[range];
  if (!hours) return null;
  const until = new Date(now.getTime());
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
}

export type ActivityFilterState = {
  action: string;
  tenantId: string;
  range: string;
  sinceDate: string;
  sinceTime: string;
  untilDate: string;
  untilTime: string;
};

export type ActivityQueryResult =
  | { ok: true; query: string }
  | { ok: false; error: string };

/** The query the filter submits. */
export function buildActivityQuery(
  state: ActivityFilterState,
  now: Date = new Date(),
): ActivityQueryResult {
  const params = new URLSearchParams();
  if (state.action.trim()) params.set("action", state.action.trim());
  if (state.tenantId.trim()) params.set("tenantId", state.tenantId.trim());

  let since: string | null = null;
  let until: string | null = null;

  if (RANGE_HOURS[state.range]) {
    const bounds = activityRangeBounds(state.range, now)!;
    since = bounds.since;
    until = bounds.until;
  } else if (state.range === "custom") {
    if (state.sinceDate || state.sinceTime) {
      since = buildIstTimestamp(state.sinceDate, state.sinceTime);
      if (!since) {
        return { ok: false, error: "Enter a complete start date and time." };
      }
    }
    if (state.untilDate || state.untilTime) {
      until = buildIstTimestamp(state.untilDate, state.untilTime);
      if (!until) {
        return { ok: false, error: "Enter a complete end date and time." };
      }
    }
  }

  if (since && until && new Date(since).getTime() > new Date(until).getTime()) {
    return {
      ok: false,
      error: "The start must not be after the end.",
    };
  }

  if (since) params.set("since", since);
  if (until) params.set("until", until);
  return { ok: true, query: params.toString() };
}
