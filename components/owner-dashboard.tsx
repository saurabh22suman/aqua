import Link from "next/link";
import {
  CalendarRange,
  ClipboardList,
  ListChecks,
  Receipt,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { OwnerHomeCharts } from "@/components/owner-home-charts";
import { OwnerHomeActions } from "@/components/owner-ui/owner-home-actions";
import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";
import { OwnerHomeAttention } from "@/components/owner-home/owner-home-attention";
import type { OwnerAttentionRow } from "@/components/owner-home/owner-home-attention";
import { OwnerHomeHeader } from "@/components/owner-home/owner-home-header";
import { OwnerHomeIllustration } from "@/components/owner-home/owner-home-illustration";
import { OwnerHomeMetrics } from "@/components/owner-home/owner-home-metrics";
import { OwnerHomeTimeline } from "@/components/owner-home/owner-home-timeline";
import type { RegisterTone } from "@/components/owner-home/session-state";
import {
  OwnerInsightsHome,
  type OwnerInsightsHomeData,
} from "@/components/owner-insights-home/owner-insights-home";
import type { ChartMetric, OwnerChartsData } from "@/lib/services/owner-home-charts";
import type {
  NeedsAttentionItem,
  OwnerDashboardData,
} from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { formatINRCompact } from "@/lib/money/format";
import { addDays } from "@/lib/time/tz";

// Owner Home — the daily oversight workspace (composition contract in
// DESIGN.md §7, and the approved Lavender Option B composition).
//
// The owner is a reviewer, not an operator: the screen answers "what
// is happening, what is owed, what needs me" and never becomes a
// capture form or an attendance-marking console.
//
// Order, top to bottom on desktop:
//   1. the day, the club and the location the figures cover, with a
//      small piece of club artwork beside the heading
//   2. Summary — four figures whose labels state whether they are
//      today's, a current balance, or a count
//   3. one dominant shortcut (collect money) + quiet secondary actions
//   4. today's classes | the attention queue
//   5. money at a glance — the collections and payment-mix panels on
//      one shared period
//   6. the insights preview — attendance by batch and enquiries by
//      current stage, one line each, detail a disclosure away
//
// Every figure is a real read from lib/services/dashboard; zeroes say
// so in words ("No payments recorded today yet"), an unavailable
// percentage is "—", and completion (marks recorded) is never labelled
// attendance. Nothing here invents growth, targets, profit or weather.

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
};

// The reserved money/attention tokens live in this file — the one the
// semantic-token rule sanctions for the owner's attention list — so the
// tone classes are chosen here and handed down. A new file may not
// carry these tokens itself.
const ATTENTION_ICON_CLASS: Record<"warn" | "late", string> = {
  warn: "bg-warn-soft text-warn",
  late: "bg-late-soft text-late",
};

const REGISTER_TONE_CLASS: Record<RegisterTone, string> = {
  neutral: "text-ink-3",
  warn: "text-warn",
  good: "text-good",
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
  insights = null,
  showOnboarding = false,
  can = {
    addMember: false,
    recordPayment: false,
    captureEnquiry: false,
    readFees: false,
    viewSchedule: false,
  },
  trend = "attendance",
  facility = null,
  illustrationSeed = null,
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
  trend?: ChartMetric;
  // The resolved facility scope, carried into every drill-down link so
  // a narrowed Home never opens an unnarrowed destination.
  facility?: string | null;
  // A stable seed for the club artwork. The caller passes the tenant
  // id so the picture is chosen once for the visit.
  illustrationSeed?: string | null;
}) {
  const displayName = branding.displayName ?? data.tenantName;
  const membersOther = resolveTerm(terminology, "member", "other");
  const memberOne = resolveTerm(terminology, "member", 1);
  const batchesOther = resolveTerm(terminology, "batch", "other");
  const batchOne = resolveTerm(terminology, "batch", 1);
  const sessionsOther = resolveTerm(terminology, "session", "other");
  const sessionsOne = resolveTerm(terminology, "session", 1);
  const coachOne = resolveTerm(terminology, "coach", 1);
  const enquiryOne = resolveTerm(terminology, "enquiry", 1);
  const facilitiesOther = resolveTerm(terminology, "facility", "other");
  const programsOther = resolveTerm(terminology, "program", "other");

  const scopeLabel =
    data.scopeLocationName ??
    (data.facilityBreakdown.length > 1 ? "All locations" : null);
  const attention = data.needsAttention;
  const hasOverdue = data.money.overdueInvoiceCount > 0;
  const sessionCount = data.todaysLanes.length;

  const withFacility = (href: string) =>
    facility ? `${href}${href.includes("?") ? "&" : "?"}facility=${facility}` : href;
  const scopeParams = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    if (facility) query.set("facility", facility);
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
  const membersHref = withFacility("/owner/members");
  const scheduleHref = facility
    ? `/owner/schedule?date=${data.today}&location=${facility}`
    : `/owner/schedule?date=${data.today}`;

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
    items.map((item) => {
      const tone: "late" | "warn" = isMoneyLate(item) ? "late" : "warn";
      return {
        title: item.title,
        detail: item.detail,
        href: item.href,
        tone,
        iconClassName: ATTENTION_ICON_CLASS[tone],
      };
    });

  // The artwork is chosen from the club's own programme names.
  const programNames = [
    ...data.todaysLanes.map((lane) => lane.programName),
    ...(data.nextClass ? [data.nextClass.programName] : []),
  ].filter((name): name is string => typeof name === "string" && name.length > 0);

  return (
    <main data-testid="owner-home" className="px-5 pt-5 pb-8">
      {/* 1 — the day, the club and the scope, with the club artwork. */}
      <OwnerHomeHeader
        displayName={displayName}
        scopeLabel={scopeLabel}
        today={data.today}
        illustration={
          <div className="flex flex-none items-center gap-2">
            {/* The phone's account control. On a desktop the same
                affordance is the shell's sidebar account row, so the
                two are never on screen together. */}
            <OwnerAccountControl className="lg:hidden" />
            <OwnerHomeIllustration
              programNames={programNames}
              seed={illustrationSeed ?? `${data.tenantName}|${data.today}`}
            />
          </div>
        }
      />

      {/* 2 — Summary. Each label states its basis: today, current
          balance, or a count. A figure that could not be read is "—",
          never ₹0. The tiles are pastel surfaces with a state-coloured
          icon chip (batch 4), so four figures can be scanned instead
          of read as four identical white cards. A phone keeps the two
          money figures as cards and the other two as one compact line. */}
      <OwnerHomeMetrics
        cards={[
          {
            key: "collected",
            label: "Collected today",
            value: formatINRCompact(data.money.collectedTodayPaise),
            hint:
              data.money.collectedTodayCount === 0
                ? "No payments recorded today yet"
                : `${data.money.collectedTodayCount} payment${
                    data.money.collectedTodayCount === 1 ? "" : "s"
                  } recorded`,
            href: can.readFees ? fees.collected : undefined,
            tone: "money",
            icon: { node: <Wallet size={17} strokeWidth={2} />, tone: "good" },
          },
          {
            key: "overdue",
            label: "Overdue",
            value: (
              <span className={hasOverdue ? "text-late" : undefined}>
                {formatINRCompact(data.money.overduePaise)}
              </span>
            ),
            hint:
              hasOverdue
                ? `${data.money.overdueInvoiceCount} invoice${
                    data.money.overdueInvoiceCount === 1 ? "" : "s"
                  } past due · ${formatINRCompact(data.money.outstandingPaise)} outstanding`
                : `Nothing past due · ${formatINRCompact(
                    data.money.outstandingPaise,
                  )} outstanding`,
            href: can.readFees ? fees.dues : undefined,
            // The late surface is for money that IS late. A quiet
            // morning is a calm tile, not an alarm.
            tone: hasOverdue ? "late" : "paper",
            icon: {
              node: <TriangleAlert size={17} strokeWidth={2} />,
              tone: hasOverdue ? "late" : "neutral",
            },
          },
          {
            key: "members",
            label: `Active ${membersOther}`,
            value: data.activeMemberCount,
            hint: `${data.activeBatchCount} ${
              data.activeBatchCount === 1 ? batchOne : batchesOther
            } running`,
            href: membersHref,
            tone: "info",
            icon: { node: <Users size={17} strokeWidth={2} />, tone: "water" },
            compactOnly: true,
          },
          {
            key: "sessions",
            label: `${titleCase(sessionsOther)} today`,
            value: sessionCount,
            hint:
              sessionCount === 0
                ? "Nothing scheduled today"
                : `${data.todayTotal} ${membersOther} enrolled`,
            href: can.viewSchedule ? scheduleHref : undefined,
            tone: "butter",
            icon: {
              node: <CalendarRange size={17} strokeWidth={2} />,
              tone: "marine",
            },
            compactOnly: true,
          },
        ]}
        compactSummary={`${data.activeMemberCount} active ${membersOther} · ${data.activeBatchCount} ${
          data.activeBatchCount === 1 ? batchOne : batchesOther
        } · ${sessionCount} ${sessionCount === 1 ? sessionsOne : sessionsOther} today`}
      />

      {/* 3 — one dominant shortcut. Money is the owner's authority, so
          collecting a payment is the primary action and goes to the
          real journey (Dues → open an invoice → record payment), never
          to a history list. Secondary actions are quiet. */}
      <OwnerHomeActions
        collectHref={can.recordPayment ? fees.dues : null}
        addMemberHref={can.addMember ? "/owner/members/new" : null}
        captureEnquiryHref={can.captureEnquiry ? "/owner/enquiries" : null}
        memberLabel={memberOne}
        enquiryLabel={enquiryOne}
      />

      {/* 4 — desktop 60/40: the day's classes beside the exceptions.
          On mobile the queue comes first so the actionable items are
          reachable early; the day's classes follow. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5 lg:items-start">
        <div className="order-2 min-w-0 lg:order-1 lg:col-span-3">
          <OwnerHomeTimeline
            lanes={data.todaysLanes}
            marked={data.todayMarked}
            enrolled={data.todayTotal}
            membersLabel={membersOther}
            coachLabel={coachOne}
            sessionsLabel={sessionCount === 1 ? sessionsOne : sessionsOther}
            registerToneClass={(tone) => REGISTER_TONE_CLASS[tone]}
            scheduleHref={can.viewSchedule ? scheduleHref : null}
            nextClass={data.nextClass}
          />
        </div>

        <div className="order-1 min-w-0 lg:order-2 lg:col-span-2">
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
        </div>
      </div>

      {/* 5 — money at a glance: the collections panel and the payment
          mix on ONE shared period, scoped to the selected facility and
          the tenant's own time zone. */}
      <OwnerHomeCharts
        data={chartsData ?? null}
        metric={trend}
        facility={facility}
        canReadFees={can.readFees}
        today={data.today}
      />

      {/* 6 — the insights section: the two read models (attendance by
          batch, enquiries by current stage) as one quiet preview with
          the detail a disclosure away. It is absent, not empty, when
          the caller may not read operational reports. */}
      {insights ? (
        <OwnerInsightsHome
          data={insights}
          facility={facility}
          canOpenEnquiries={can.readEnquiries ?? false}
        />
      ) : null}

      {/* W1-6 — consolidated per-facility view, only for multi-site
          tenants; a single site needs no comparison. */}
      {data.facilityBreakdown.length > 1 ? (
        <section className="mt-4">
          <SectionHeader
            className="mb-2"
            title={`By ${facilitiesOther}`}
          />
          <ul className="divide-y divide-line rounded-card border border-line bg-paper">
            {data.facilityBreakdown.map((row) => (
              <li
                key={row.locationId}
                className="flex items-center justify-between gap-3 px-3.5 py-3"
              >
                <span className="min-w-0 truncate text-[13.5px] font-medium">
                  {row.locationName}
                </span>
                <span className="flex-none text-[12px] text-ink-3">
                  {row.activeMembers} active ·{" "}
                  {row.attendancePct === null
                    ? "no attendance yet"
                    : `${row.attendancePct}% this week`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Phone access to the destinations the four-item bottom nav does
          not carry. Desktop reaches them from the sidebar. */}
      <div className="mt-4 grid grid-cols-2 gap-2 lg:hidden">
        {[
          { href: "/owner/fees", label: "Fees & payments", icon: Receipt },
          {
            href: "/owner/enquiries",
            label: titleCase(resolveTerm(terminology, "enquiry", "other")),
            icon: ClipboardList,
          },
          {
            href: "/owner/programs",
            label: `${titleCase(programsOther)} & ${batchesOther}`,
            icon: CalendarRange,
          },
          { href: "/owner/staff", label: "Staff", icon: Users },
          ...(showOnboarding
            ? [{ href: "/owner/onboarding", label: "Onboarding", icon: ListChecks }]
            : []),
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex min-h-12 items-center gap-2.5 rounded-ctl border border-[var(--control-border)] bg-paper px-4 py-2 motion-fast transition-colors hover:border-[var(--control-border-hover)]"
          >
            <link.icon size={16} className="flex-none text-ink-3" aria-hidden="true" />
            <span className="text-[13px] font-medium">{link.label}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
