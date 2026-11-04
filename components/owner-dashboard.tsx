import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerHomeAttention } from "@/components/owner-home/owner-home-attention";
import type { OwnerAttentionRow } from "@/components/owner-home/owner-home-attention";
import { OwnerHomeHeader } from "@/components/owner-home/owner-home-header";
import { OwnerHomeMoney } from "@/components/owner-home/owner-home-money";
import { OwnerHomeTimeline } from "@/components/owner-home/owner-home-timeline";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import {
  type OwnerInsightsHomeData,
} from "@/components/owner-insights-home/owner-insights-home";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { OwnerPeriodKey } from "@/lib/time/owner-periods";
import type {
  NeedsAttentionItem,
  OwnerDashboardData,
} from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { ArtworkIdentity } from "@/components/owner-artwork/preference";
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";
import { addDays, formatDateIST } from "@/lib/time/tz";

// Owner Home — the daily oversight workspace (composition contract in
// DESIGN.md §7, and the accepted Lavender Option B composition).
//
// The owner is a reviewer, not an operator: the screen answers "what
// is happening, what is owed, what needs me" and never becomes a
// capture form or an attendance-marking console.
//
// The accepted composition (owner mock, 2 November 2026) is ONE
// collections card, ONE invoice shortcut and the day's sessions:
//
//   1. the day and the scope the figures cover
//   2. the collections card — today's collection, the last seven days,
//      the contextual "Record payment" action and the secondary
//      "View trend" link, over the club artwork
//   3. the invoice shortcut — the outstanding/overdue review, which
//      keeps its own route
//   4. today's classes — each row owns its own places taken and
//      capacity, so there is no second capacity panel printing the
//      same facts
//   5. the decision queue — what needs the owner, in the service's own
//      priority order
//
// The Quick actions box and the duplicate "Find a member" tile are
// gone: an owner reaches Members, Enquiries and Bookings from their own
// navigation, and a home screen that repeats those shortcuts next to
// the one action that matters only adds noise. Every figure is a real
// read from lib/services/dashboard; zeroes say so in words ("No
// payments recorded today yet"), an unavailable percentage is "—", and
// completion (marks recorded) is never labelled attendance. Nothing
// here invents growth, targets, profit or weather.

const MAX_ATTENTION_ROWS = 3;

type Can = {
  addMember: boolean;
  recordPayment: boolean;
  captureEnquiry: boolean;
  readFees: boolean;
  viewSchedule: boolean;
  // Whether the caller may open the enquiries LIST. Optional so a
  // caller that does not need the insights drill-down can leave it
  // unset — the link is simply not offered.
  readEnquiries?: boolean;
  // Whether the caller may open the programs and batches board, and
  // the staff directory. These are UI names for what the destinations
  // themselves enforce; an unset flag withholds the shortcut.
  readPrograms?: boolean;
  readStaff?: boolean;
  readMembers?: boolean;
  bookCourt?: boolean;
  // Whether the caller may open the collections TREND report. The
  // destination enforces reports.financial, invoices.read and the
  // reports/billing entitlements, so the flag is computed with exactly
  // those checks — the "View trend" link is never offered to someone
  // the report would refuse.
  viewTrend?: boolean;
};

/**
 * The attention row that is about money that is LATE. It is the one
 * row that may never be folded away behind a disclosure, so it is
 * checked by the same predicate that decides its tone.
 */
function isMoneyLate(item: NeedsAttentionItem): boolean {
  return item.title === "Overdue fees";
}

export function OwnerDashboard({
  data,
  branding,
  terminology,
  chartsData,
  showOnboarding = false,
  can = {
    addMember: false,
    recordPayment: false,
    captureEnquiry: false,
    readFees: false,
    viewSchedule: false,
  },
  facility = null,
  artworkIdentity,
  period = "last7",
}: {
  data: OwnerDashboardData;
  branding: BrandingData;
  terminology: TerminologyState;
  chartsData?: OwnerChartsData | null;
  // The insights read models, already scoped to the selected facility.
  // null — the caller may not read them, so the section is not
  // rendered at all.
  insights?: OwnerInsightsHomeData | null;
  // Only a genuinely new academy gets the setup prompt; an established
  // academy with one unfinished checklist item does not.
  showOnboarding?: boolean;
  can?: Can;
  // The selected range for the trend band and the attendance summary.
  // One range, one owner: the range strip above the band.
  period?: OwnerPeriodKey;
  // The resolved facility scope, carried into every drill-down link so
  // a narrowed Home never opens an unnarrowed destination.
  facility?: string | null;
  // A stable seed for the club artwork. The caller passes the tenant
  // id so the picture is chosen once for the visit.
  illustrationSeed?: string | null;
  artworkIdentity?: ArtworkIdentity;
}) {
  const displayName = branding.displayName ?? data.tenantName;
  const sessionsOther = resolveTerm(terminology, "session", "other");
  const sessionsOne = resolveTerm(terminology, "session", 1);
  const coachOne = resolveTerm(terminology, "coach", 1);

  const scopeLabel =
    data.scopeLocationName ??
    (data.facilityBreakdown.length > 1 ? "All locations" : null);
  const attention = data.needsAttention.filter((item) => !isMoneyLate(item) && (can.readFees || item.title !== "Cash count needs review"));
  const sessionCount = data.todaysLanes.length;

  const scopeParams = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    query.set("facility", facility ?? "all");
    return `/owner/fees?${query.toString()}`;
  };

  const fees = {
    collected: scopeParams({
      tab: "transactions",
      from: data.today,
      to: addDays(data.today, 1),
    }),
    dues: scopeParams({ tab: "dues" }),
  };
  const scheduleHref = facility
    ? `/owner/schedule?date=${data.today}&location=${facility}`
    : `/owner/schedule?date=${data.today}`;
  // The trend report is the REAL drill-down for the collections figure,
  // and it carries the same scope and the same range the card was read
  // under — a narrowed Home never opens an unnarrowed destination.
  // The selected range, compact: the charts read's own from/to dates, the
  // same window the seven-day figure was read under. No charts read → no
  // pill (never an invented window).
  const rangeLabel = chartsData?.period
    ? `${formatDateIST(chartsData.period.currentFromDate).replace(/ \d{4}$/, "")} – ${formatDateIST(chartsData.period.currentToDate).replace(/ \d{4}$/, "")}`
    : null;
  const trendHref = can.viewTrend && can.readFees
    ? `/owner/reports/collections?${new URLSearchParams({
        view: "trends",
        period: period ?? "last7",
        facility: facility ?? "all",
      })}`
    : null;

  // The attention queue: the first rows carry the list, and a row that
  // is about money that is LATE is never one of the folded ones.
  const visibleAttention: NeedsAttentionItem[] = [];
  const hiddenAttention: NeedsAttentionItem[] = [];
  for (const item of attention) {
    if (visibleAttention.length < MAX_ATTENTION_ROWS || isMoneyLate(item)) {
      visibleAttention.push(item);
    } else {
      hiddenAttention.push(item);
    }
  }
  const attentionRows = (items: NeedsAttentionItem[]): OwnerAttentionRow[] =>
    items.map((item) => ({
      title: item.title,
      detail: item.detail,
      href: item.href,
    }));

  return (
    <OwnerPage data-testid="owner-home">
      {/* 1 — the day and the scope the figures cover. */}
      <OwnerHomeHeader
        displayName={displayName}
        scopeLabel={scopeLabel}
        today={data.today}
      />
      {showOnboarding ? <Link href="/owner/onboarding" className="mt-4 inline-flex min-h-11 items-center rounded-ctl border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-deck focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">Set up your club</Link> : null}

      {/* 2 — the collections card: today's collection, the last seven
          days, and the two actions that belong to collections. */}
      <div
        data-testid="owner-home-lead"
        className="mt-4"
      >
        <div className="min-w-0">
          {can.readFees && data.money ? <OwnerHomeMoney
            money={data.money}
            artworkIdentity={artworkIdentity}
            last7Paise={can.readFees && chartsData?.period.key === "last7" ? chartsData.collections.totalPaise : null}
            collectedHref={can.readFees ? fees.collected : null}
            collectHref={can.recordPayment && can.readFees ? fees.dues : null}
            trendHref={trendHref}
            rangeLabel={rangeLabel}
          /> : null}
        </div>

      </div>

      {/* 3 — the day's sessions follow the Collections card directly (the
          approved composition). Each row states the time, the class with a
          readable coach/facility line, and one truthful soft state pill. */}
      <div data-testid="owner-home-work" className="mt-5">
        <OwnerHomeTimeline
          lanes={data.todaysLanes}
          coachLabel={coachOne}
          sessionLabel={sessionsOne}
          sessionsLabel={sessionCount === 1 ? sessionsOne : sessionsOther}
          scheduleHref={can.viewSchedule ? scheduleHref : null}
          nextClass={data.nextClass}
        />
      </div>

      {attention.length > 0 || showOnboarding ? <div className="mt-5">
          <OwnerHomeAttention
            rows={attentionRows(visibleAttention)}
            hiddenRows={attentionRows(hiddenAttention)}
            count={attention.length}
            summary={
              attention.length === 0
                ? "Nothing needs your attention today"
                : `${attention.length} thing${
                    attention.length === 1 ? "" : "s"
                  } to keep your club on track`
            }
            onEmpty={
              showOnboarding ? (
                <p className="mt-1 text-[12.5px] text-ink-3">
                  Setting the academy up is the next thing worth doing.
                </p>
              ) : undefined
            }
          />
        </div> : null}
    </OwnerPage>
  );
}
