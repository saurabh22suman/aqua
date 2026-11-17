import {
  OWNER_HOME_RANGE_KEYS,
  OWNER_PERIOD_LABEL,
  OWNER_PERIOD_TAB_LABEL,
  type OwnerPeriodKey,
} from "@/lib/time/owner-periods";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner Home — the selected range.
//
// The range is ONE fact about ONE scope, so it has ONE display owner:
// this toolbar. The collections panel, the payment mix and the attendance
// summary below all read the same range, and none of them repeats its
// name, its dates or its comparison.
//
// The toolbar is COMPACT. It carries the control and nothing else: no
// eyebrow, no sentence describing what the range covers (the Money
// section states what it owns, and the attendance panel states its own
// scope). The exact instants and the meaning of the comparison stay in
// an accessible disclosure, because the numbers have to be checkable
// without guessing — but a disclosure is a control, not a bar that is
// always on screen.
//
// The control keeps the facility scope in the URL, so changing the range
// never widens what the owner may read.
//
// The Monday-to-now "week" window is still a supported key (the URL and
// the service accept `period=week`), but it is not one of the three
// offered choices. When it is opened, the toolbar says so — truthfully,
// and in the range's own words — instead of lighting a button that does
// not mean it or leaving the owner with an unexplained unlit control.
//
// It says only that. "a range the three choices above do not offer" is
// an implementation sentence about the TOOLBAR, not about the range, so
// it is not printed to the owner; which control is missing is a fact
// about the toolbar, not about the window being read.

export function OwnerHomeRange({
  data,
  period,
  facility,
}: {
  /** The read model, when it could be read. Null → no exact ranges. */
  data: OwnerChartsData | null;
  /** The selected range key. */
  period: OwnerPeriodKey;
  facility: string | null;
}) {
  const scope = (key: OwnerPeriodKey) => {
    const query = new URLSearchParams({ period: key });
    if (facility) query.set("facility", facility);
    return `/owner?${query.toString()}`;
  };

  // A range the buttons do not offer (the Monday-to-now "week"). It is
  // named, never relabelled. The window's own name is the fallback
  // when the charts read failed and there is no label to read.
  const offered = OWNER_HOME_RANGE_KEYS.includes(period);
  const stateLabel = data?.period.tabLabel ?? OWNER_PERIOD_TAB_LABEL[period];

  return (
    <div data-testid="owner-home-range" className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <nav
          aria-label="Range"
          className="flex flex-none rounded-pill border border-line bg-paper p-0.5"
        >
          {/* Range changes use one full navigation for an authoritative server render. */}
          {OWNER_HOME_RANGE_KEYS.map((key) => (
            <a
              key={key}
              href={scope(key)}
              aria-current={key === period ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-pill px-3 text-[12.5px] font-medium transition-colors duration-150 ${
                // The selected control wears the PRESET ACCENT, so the
                // range reads as part of the theme in both presets.
                key === period
                  ? "bg-[var(--accent-strong)] text-white"
                  : "text-ink-2 hover:text-ink"
              }`}
            >
              {OWNER_PERIOD_LABEL[key]}
            </a>
          ))}
        </nav>

        {offered ? null : (
          <p
            data-testid="owner-home-range-state"
            className="text-[12.5px] text-ink-2"
          >
            Showing {lowerFirst(stateLabel)}
          </p>
        )}

        {data ? <RangeDetail data={data} /> : null}
      </div>
    </div>
  );
}

/** "This week" reads as a sentence, not as a title. */
function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * The exact instants of the selected range and of the range it is
 * compared with, plus the meaning of the comparison. It is a native
 * disclosure: it works with no JavaScript and from a keyboard, and it
 * keeps the exact values reachable without repeating them beside every
 * panel. The control is a plain summary; the detail carries the surface.
 */
function RangeDetail({ data }: { data: OwnerChartsData }) {
  const { period, timezone } = data;
  return (
    <details data-testid="owner-home-range-detail" className="max-w-[72ch]">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-[12.5px] text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
        How this is measured
      </summary>
      <dl className="mt-1 grid gap-x-4 gap-y-1 rounded-ctl bg-deck px-3 py-2 text-[12px] text-ink-3 sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium text-ink-2">Selected range</dt>
        <dd>{period.currentLabel} ({timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta" ? "IST" : timezone})</dd>
        <dt className="font-medium text-ink-2">Compared with</dt>
        <dd>{period.previousLabel}</dd>
      </dl>
      <p className="mt-1 text-[12px] text-ink-3">{period.comparisonMeaning}</p>
      {period.capNote ? (
        <p className="mt-0.5 text-[12px] text-ink-3">{period.capNote}</p>
      ) : null}
    </details>
  );
}
