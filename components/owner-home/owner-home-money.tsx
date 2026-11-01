import Link from "next/link";
import { OwnerArtwork } from "@/components/owner-artwork/owner-artwork";
import type { ArtworkIdentity } from "@/components/owner-artwork/preference";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

export function OwnerHomeMoney({ money, collectedHref, last7Paise = null, artworkIdentity }: {
  money: NonNullable<OwnerDashboardData["money"]>;
  context: { activeMemberCount: number; activeBatchCount: number; sessionCount: number; membersLabel: string; batchesLabel: string; sessionsLabel: string };
  collectedHref?: string | null;
  collectHref: string | null;
  addMemberHref: string | null;
  captureEnquiryHref: string | null;
  memberLabel: string;
  enquiryLabel: string;
  last7Paise?: number | null;
  artworkIdentity?: ArtworkIdentity;
}) {
  const today = formatINRCompact(money.collectedTodayPaise);
  const last7 = last7Paise === null ? "Unavailable" : formatINRCompact(last7Paise);
  const figure = (value: string) => `font-display font-semibold tabular-nums leading-tight ${value.length > 9 ? "text-lg [overflow-wrap:anywhere]" : "whitespace-nowrap text-[26px]"}`;
  return (
    <section data-testid="owner-home-money-surface" aria-label="Collections" className="relative overflow-hidden rounded-card bg-[var(--owner-hero)] p-5 text-[var(--owner-hero-ink)]">
      <OwnerArtwork identity={artworkIdentity} />
      <h2 className="relative font-display text-lg font-semibold">Collections</h2>
      <div className="relative mt-3 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <p className="text-[13px]">Today</p>
          {collectedHref ? <Link href={collectedHref} aria-label={`${today} collected today — view today's transactions`} className={`inline-flex min-h-11 min-w-11 items-start ${figure(today)}`}>{today}</Link> : <p className={`min-h-11 ${figure(today)}`}>{today}</p>}
        </div>
        <div className="min-w-0">
          <p className="text-[13px]">Last 7 days</p>
          <p className={`min-h-11 ${figure(last7)}`}>{last7}</p>
        </div>
      </div>
      <p className="relative mt-3 text-xs">Manually recorded payments</p>
    </section>
  );
}
