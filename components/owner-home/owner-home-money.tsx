import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerArtwork } from "@/components/owner-artwork/owner-artwork";
import type { ArtworkIdentity } from "@/components/owner-artwork/preference";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

// The caller supplies already-authorized, scoped destinations. The separate
// collections card owns the selected range and trend; this hero is today only.
export function OwnerHomeMoney({
  money,
  collectedHref,
  artworkIdentity,
  collectHref = null,
}: {
  money: NonNullable<OwnerDashboardData["money"]>;
  collectedHref?: string | null;
  // Retained for existing callers; the range belongs to the collections card.
  last7Paise?: number | null;
  artworkIdentity?: ArtworkIdentity;
  collectHref?: string | null;
  trendHref?: string | null;
  rangeLabel?: string | null;
}) {
  const today = formatINRCompact(money.collectedTodayPaise);
  const count = money.collectedTodayCount;
  const focusRing = "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-hero-ink)]";
  return (
    <section
      data-testid="owner-home-money-surface"
      aria-label="Collections"
      className="relative overflow-hidden rounded-[18px] bg-[var(--owner-hero)] p-[18px] text-[var(--owner-hero-ink)] lg:p-5"
    >
      <OwnerArtwork identity={artworkIdentity} />
      <div
        aria-hidden="true"
        data-testid="owner-home-hero-veil"
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(to bottom, color-mix(in srgb, var(--owner-hero) 45%, transparent), color-mix(in srgb, var(--owner-hero) 22%, transparent))" }}
      />
      <div className="relative min-w-0">
        <h2 className="text-[13px] font-medium">Collected today</h2>
        <p className="mt-2 min-w-0 font-display text-[38px] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere]">{today}</p>
        <p className="mt-2 text-[12px]">{count} {count === 1 ? "payment" : "payments"} recorded</p>
        {collectedHref || collectHref ? <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {collectedHref ? <Link href={collectedHref} className={`inline-flex min-h-11 items-center gap-1.5 rounded-ctl border border-white/25 bg-white/15 px-3.5 text-[13px] font-medium text-[var(--owner-hero-ink)] hover:bg-white/25 ${focusRing}`}>View payments <OwnerIcon name="chevron" size={16} /></Link> : null}
          {collectHref ? <Link href={collectHref} className={`inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-[var(--owner-hero-ink)] underline decoration-transparent underline-offset-4 hover:decoration-current ${focusRing}`}><OwnerIcon name="money" size={16} />Record payment</Link> : null}
        </div> : null}
      </div>
    </section>
  );
}
