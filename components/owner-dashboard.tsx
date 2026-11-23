import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerHomeAttention } from "@/components/owner-home/owner-home-attention";
import type { OwnerAttentionRow } from "@/components/owner-home/owner-home-attention";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerHomeHeader } from "@/components/owner-home/owner-home-header";
import { OwnerHomePriority } from "@/components/owner-home/owner-home-priority";
import { OwnerScoreCell } from "@/components/owner-home/owner-scoreline";
import { OwnerHomeNextSession } from "@/components/owner-home/owner-home-next-session";
import { OwnerHomeFinancialSnapshot } from "@/components/owner-home/owner-home-financial-snapshot";
import { OwnerHomeTimeline } from "@/components/owner-home/owner-home-timeline";
import { OwnerHomeCollectionsTrend } from "@/components/owner-home/owner-home-collections-trend";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
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
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";
import { addDays, formatWeekdayDateIST } from "@/lib/time/tz";

// Today is composed from the existing scoped dashboard and chart reads.
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
  period = "last7",
  guideKey,
  floodlitSport = "court",
}: {
  guideKey?: string;
  floodlitSport?: "court" | "pool";
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
}) {
  const sessionsOther = resolveTerm(terminology, "session", "other");
  const sessionsOne = resolveTerm(terminology, "session", 1);
  const coachOne = resolveTerm(terminology, "coach", 1);

  const attention = data.needsAttention.filter((item) => can.readFees || (!isMoneyLate(item) && item.title !== "Cash count needs review"));
  const sessionCount = data.todaysLanes.length;
  const nextClass = data.nextClass;
  // The agenda and calendar already cover a next session listed today.
  const separateNextClass = nextClass && (
    nextClass.sessionDate !== data.today ||
    !data.todaysLanes.some(lane => lane.batchId === nextClass.batchId)
  ) ? nextClass : null;

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
  const membersHref = `/owner/members?${new URLSearchParams({ facility: facility ?? "all" }).toString()}`;
  const scheduleHref = `/owner/schedule?${new URLSearchParams({ date: data.today, facility: facility ?? "all" }).toString()}`;
  // The scoreboard's own calendar link: the NEXT session's real date, not
  // today's. It stays field-for-field scoped with the facility the figure
  // was read under, and is only built when the caller may open Schedule.
  const nextSessionHref = data.nextClass
    ? `/owner/schedule?${new URLSearchParams({ date: data.nextClass.sessionDate, facility: facility ?? "all" }).toString()}`
    : null;
  // The trend report is the REAL drill-down for the collections figure,
  // and it carries the same scope and the same range the card was read
  // under — a narrowed Home never opens an unnarrowed destination.
  // Overdue is the same dues read the finance card's figures came from,
  // narrowed by the fees hub's own overdue flag; the destination applies
  // the tenant-local due-date cut, so Home never invents one.
  const overdueHref = scopeParams({ tab: "dues", overdue: "1" });
  const trendHref = can.viewTrend && can.readFees
    ? `/owner/reports/collections?${new URLSearchParams({
        view: "trends",
        period: chartsData?.period.key ?? period,
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
  // The priority card is the first item of the service's own priority
  // order (cash discrepancy, then the billing decision, then the
  // follow-ups, then the register) — never a separately chosen item.
  const priorityItem = attention[0] ?? null;
  const priorityIsOverdue = priorityItem ? isMoneyLate(priorityItem) : false;
  const overdueCount = data.money?.overdueInvoiceCount ?? 0;
  const oldest = data.money?.oldestOverdueDays;
  const priorityDetail = priorityIsOverdue && overdueCount > 0
    ? `${overdueCount} ${overdueCount === 1 ? "invoice" : "invoices"} past due${oldest ? ` · oldest ${oldest} ${oldest === 1 ? "day" : "days"} late` : ""}`
    : priorityItem?.detail;
  const attentionDestination = (item: NeedsAttentionItem) => isMoneyLate(item)
    ? overdueHref
    : item.href === "/owner/reports/collections"
      ? `/owner/reports/collections?${new URLSearchParams({ facility: facility ?? "all" })}`
      : item.href;
  const priorityHref = priorityItem ? attentionDestination(priorityItem) : undefined;
  const priorityAction = priorityItem?.title === "Cash count needs review" ? "Open cash count"
    : priorityIsOverdue ? "Open overdue invoices"
    : priorityItem?.title === "Follow-up overdue" ? "Open enquiry"
    : priorityItem?.title === "Register not started" ? "View register"
    : "Review";
  const attentionRows = (items: NeedsAttentionItem[]): OwnerAttentionRow[] =>
    items.map((item) => ({
      title: item.title,
      detail: item.detail,
      href: attentionDestination(item),
    }));

  const showAttention = attention.length > 0 || can.readFees || showOnboarding;

  // Keep the authorized quick action below the agenda and collections.
  const enquiryAction =
    can.captureEnquiry && can.readEnquiries ? (
      <Link
        href="/owner/enquiries?capture=1"
        className="inline-flex min-h-11 items-center gap-1.5 text-[12.5px] font-medium text-[var(--accent-ink)]"
      >
        <OwnerIcon name="plus" size={16} />
        New enquiry
      </Link>
    ) : null;

  return (
    <OwnerPage
      data-testid="owner-home"
      data-floodlit-owner=""
      data-floodlit-sport={floodlitSport}
      className="floodlit-workspace courtside-home"
    >
      <section
        className="floodlit-hero"
        data-testid="owner-floodlit-hero"
        aria-labelledby="owner-home-title"
      >
        <OwnerHomeHeader today={data.today} />
        {can.readFees ? (
          <OwnerHomeFinancialSnapshot
            money={data.money}
            paymentsHref={fees.collected}
            invoicesHref={fees.dues}
            overdueHref={priorityIsOverdue ? null : overdueHref}
          />
        ) : null}
      </section>

      <OwnerHomePriority
        className="floodlit-priority priority courtside-workspace-priority"
        item={priorityItem}
        detail={priorityDetail}
        action={priorityAction}
        actionHref={priorityHref}
      />

      <div className={`floodlit-support${can.readFees ? "" : " floodlit-support-single"}`}>
        <OwnerHomeTimeline
          id="owner-agenda"
          lanes={data.todaysLanes}
          dateLabel={formatWeekdayDateIST(data.today)}
          coachLabel={coachOne}
          sessionLabel={sessionsOne}
          sessionsLabel={sessionCount === 1 ? sessionsOne : sessionsOther}
          scheduleHref={can.viewSchedule ? scheduleHref : null}
          nextClass={data.nextClass}
          lead={separateNextClass ? (
            <OwnerHomeNextSession
              nextClass={separateNextClass}
              siteLabel={data.scopeLocationName}
              scheduleHref={can.viewSchedule ? nextSessionHref ?? scheduleHref : null}
            />
          ) : null}
        />
        {can.readFees ? <OwnerHomeCollectionsTrend data={chartsData} href={trendHref} /> : null}
      </div>
      {enquiryAction ? <div className="flex justify-end">{enquiryAction}</div> : null}

      <ul className="courtside-scoreline" aria-label="Overview totals">
        <OwnerScoreCell count={sessionCount} label="Sessions today" icon="calendar" href="#owner-agenda" />
        <OwnerScoreCell count={attention.length} label="Need attention" icon="alert" href={showAttention ? "#owner-attention" : undefined} />
        <OwnerScoreCell count={data.activeMemberCount} label="Active members" icon="members" href={can.readMembers ? membersHref : undefined} />
      </ul>

      {showAttention ? (
        <div id="owner-attention" tabIndex={-1}>
          <OwnerHomeAttention
            rows={attentionRows(visibleAttention)}
            hiddenRows={attentionRows(hiddenAttention)}
            count={attention.length}
            summary={attention.length === 0 ? "No items to review today" : ""}
            onEmpty={showOnboarding ? <p className="text-[13px] text-ink-2">Finish setting up your club.</p> : undefined}
            footer={can.readFees && data.money ? (
              <Link className="courtside-attention-action" href={fees.dues}>
                <OwnerIcon name="invoice" size={18} />
                <span><strong>{can.recordPayment ? "Record payment" : "Review open invoices"}</strong><small>Fees and payments</small></span>
                <OwnerIcon name="chevron" size={16} />
              </Link>
            ) : null}
          />
        </div>
      ) : null}

      {showOnboarding ? (
        <Link href="/owner/onboarding" className="mt-4 inline-flex min-h-11 items-center rounded-ctl border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-deck">Set up your club</Link>
      ) : null}
      <OptionalWorkspaceGuide
        key={guideKey}
        startCollapsed
        preferenceKey={guideKey}
        title="A look around today"
        intro="Explore the overview at your own pace. This guide makes no changes."
        regionLabel="Optional daily overview guide"
        itemLabel="Overview area"
        items={[
          { key: "sessions", title: "Today's sessions", detail: "See the day's schedule and the next booked session." },
          ...(showAttention ? [{ key: "attention", title: "Needs attention", detail: "Review outstanding tasks and follow-ups." }] : []),
          ...(showOnboarding ? [{ key: "setup", title: "Register checks", detail: "The setup link opens the available register checks." }] : []),
        ]}
      />
    </OwnerPage>
  );
}
