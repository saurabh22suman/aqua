import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerArtwork } from "@/components/owner-artwork/owner-artwork";
import type { ArtworkIdentity } from "@/components/owner-artwork/preference";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

// Owner Home — the Collections card.
//
// ONE money surface, and it is the first thing the owner reads: what
// came in today, what came in over the last seven days, and the two
// actions that belong to collections.
//
// The card is a picture with a caption. The club artwork covers the
// whole card, and a veil fades it out under the words, so the line work
// never competes with an amount. Every figure printed here is a real
// read — `money.collectedTodayPaise` for the day, the charts read's
// own `collections.totalPaise` for the seven days, and "Unavailable"
// when that read could not be made. A zero is never printed for a read
// that did not happen.
//
// The manual provenance of a collection is NOT a Home badge and NOT a
// line of copy under the amounts: the truthful confirmation detail
// belongs to the payment flow itself, where the money is entered.
//
// The contextual actions are small and they are honest about where they
// go. "Record payment" opens the explicit unpaid-bill selection (the
// owner chooses the bill, then the existing payment flow records it);
// "View trend" opens the real collections trend report. Both are
// withheld by the caller, so the screen never offers a destination that
// would refuse them.

export function OwnerHomeMoney({
  money,
  collectedHref,
  last7Paise = null,
  artworkIdentity,
  collectHref = null,
  trendHref = null,
  rangeLabel = null,
}: {
  money: NonNullable<OwnerDashboardData["money"]>;
  /** The day read's drill-down — today's transactions. */
  collectedHref?: string | null;
  /** The seven-day total, straight from the charts read. */
  last7Paise?: number | null;
  artworkIdentity?: ArtworkIdentity;
  /** Where "Record payment" goes: the explicit unpaid-bill selection. */
  collectHref?: string | null;
  /** Where "View trend" goes: the collections trend report. */
  trendHref?: string | null;
  /**
   * The selected range, compact and REAL: the charts read's own from/to
   * dates. Informational only — Home has no range filter of its own.
   */
  rangeLabel?: string | null;
}) {
  const today = formatINRCompact(money.collectedTodayPaise);
  const last7 = last7Paise === null ? "Unavailable" : formatINRCompact(last7Paise);
  // The amount stays large on a 320px screen: a long figure wraps
  // instead of shrinking away or overflowing its column.
  const figure = (value: string) =>
    `font-display font-medium tabular-nums leading-tight ${
      value.length > 9 ? "text-xl [overflow-wrap:anywhere]" : "whitespace-nowrap text-[26px]"
    }`;
  // The keyboard ring on this card is LIGHT. The card is the dark
  // accent surface, and the shared --focus-ring token is that same
  // accent colour in both presets — a ring painted in it is invisible
  // (WCAG 2.4.7). The hero's own ink (white in both presets) is the
  // existing token that contrasts with the surface, so every link here
  // wears it. No new colour and no change to the global focus rule.
  const focusRing =
    "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-hero-ink)]";
  return (
    <section
      data-testid="owner-home-money-surface"
      aria-label="Collections"
      className="relative overflow-hidden rounded-card bg-[var(--owner-hero)] p-4 text-[var(--owner-hero-ink)] sm:p-5"
    >
      <OwnerArtwork identity={artworkIdentity} />
      {/* The artwork covers the whole card; this veil fades it out
          under the copy, so the line work stays a picture and never
          fights an amount. */}
      <div
        aria-hidden="true"
        data-testid="owner-home-hero-veil"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--owner-hero) 45%, transparent), color-mix(in srgb, var(--owner-hero) 22%, transparent))",
        }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <h2 className="relative font-display text-[16px] font-medium">Collections</h2>
        {rangeLabel ? (
          <span
            data-testid="owner-home-range-pill"
            className="shrink-0 rounded-pill bg-white/15 px-2.5 py-1 text-[11.5px] font-medium leading-none text-[var(--owner-hero-ink)]"
          >
            {rangeLabel}
          </span>
        ) : null}
      </div>
      {/* Today and Last 7 days: two figures with ONE rule between them. The
          Today label and amount share a single 44px target instead of
          stacking a label over a second 44px amount box. */}
      <div className="relative mt-3 grid grid-cols-2">
        <div className="min-w-0 pr-3">
          {collectedHref ? (
            <Link
              href={collectedHref}
              aria-label={`${today} collected today — view today's transactions`}
              className={`block min-h-11 ${focusRing}`}
            >
              <span className="block text-[13px]">Today</span>
              <span className={`mt-1 block ${figure(today)}`}>{today}</span>
            </Link>
          ) : (
            <div className="min-h-11">
              <span className="block text-[13px]">Today</span>
              <span className={`mt-1 block ${figure(today)}`}>{today}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 border-l border-white/25 pl-3">
          <p className="text-[13px]">Last 7 days</p>
          <p className={`mt-1 ${figure(last7)}`}>{last7}</p>
        </div>
      </div>
      {collectHref || trendHref ? (
        <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {collectHref ? (
              <Link
                href={collectHref}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-white/25 bg-white/15 px-3.5 text-[13.5px] font-medium text-[var(--owner-hero-ink)] hover:bg-white/25 ${focusRing}`}
              >
                {/* The shared Owner glyph (foundation): the approved
                    mock's own 16px outline "money" path. No private
                    icon map lives in this lane. */}
                <OwnerIcon name="money" size={16} />
                Record payment
              </Link>
            ) : null}
            {trendHref ? (
              <Link
                href={trendHref}
                className={`inline-flex min-h-11 items-center gap-1 text-[13.5px] font-medium text-[var(--owner-hero-ink)] underline decoration-transparent underline-offset-4 hover:decoration-current ${focusRing}`}
              >
                View trend
                {/* The approved mock draws the word plus its own 16px
                    outline chevron — not a text arrow. */}
                <OwnerIcon name="chevron" size={16} />
              </Link>
            ) : null}
          </div>
        ) : null}
    </section>
  );
}
