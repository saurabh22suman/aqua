import { getAttendanceReportAction, getEnquiryFunnelAction, getRetentionViewAction, getCoachLoadAction, getFacilityUtilisationAction } from "@/lib/actions/owner-reports";
import { getOperationalAnalyticsAction, getMoneyAnalyticsAction } from "@/lib/actions/owner-analytics";
import { defaultMonthPeriod } from "@/lib/services/owner-reports";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { formatPeriodRangeIST } from "@/lib/time/tz";
import { cookies } from "next/headers";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import { listLocationsAction } from "@/lib/actions/people";
import { AttendanceReportCard } from "@/components/reports/attendance-report-card";
import { EnquiryFunnelCard } from "@/components/reports/enquiry-funnel-card";
import { RetentionCard } from "@/components/reports/retention-card";
import { CoachLoadCard } from "@/components/reports/coach-load-card";
import { UtilisationCard } from "@/components/reports/utilisation-card";
import {
  AttendanceTrendCard,
  CollectionsExpensesCard,
  MemberMixCard,
  PlanRevenueCard,
} from "@/components/reports/analytics-cards";
import { ReportCardError } from "@/components/reports/report-card-error";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import Link from "next/link";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";

// Phase 4 — owner reports surface. Four cards (4.2 / 4.3 /
// 4.4 / 4.5 / 4.6), one dominant element on each. Period
// defaults to "this calendar month" in the tenant's timezone.
// The page picks up `?from=…&to=…` from the URL when set.
//
// W1-6 continuation — a facility selection scopes the cards that
// carry a location dimension (attendance, analytics, collections,
// utilisation) and hides the ones that do not yet (enquiry funnel,
// retention, coach load), with an explicit note instead of showing
// tenant-wide numbers under a single-site heading.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string; facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const facility = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );
  const timezone = await getTenantTimezoneAction();
  const defaultPeriod = defaultMonthPeriod(timezone);
  const period = (() => {
    if (params.from && params.to) return { from: params.from, to: params.to };
    return defaultPeriod;
  })();
  const isDefaultMonth =
    period.from === defaultPeriod.from && period.to === defaultPeriod.to;

  const [
    attendance,
    enquiry,
    retention,
    coachLoad,
    utilisation,
    operational,
    money,
    locations,
  ] = await Promise.allSettled([
    getAttendanceReportAction({
      ...period,
      ...(facility ? { locationId: facility } : {}),
    }),
    facility ? Promise.resolve([]) : getEnquiryFunnelAction(period),
    facility ? Promise.resolve(null) : getRetentionViewAction(),
    facility ? Promise.resolve([]) : getCoachLoadAction(period),
    // V-08 — facility utilisation for the last 4 weeks, scoped by the
    // switcher when one is selected.
    getFacilityUtilisationAction(facility ? { locationId: facility } : {}),
    // U-01 — the analytics series. Operational and financial are
    // separate actions because they carry different permission keys;
    // an owner holds both.
    getOperationalAnalyticsAction(period, facility),
    getMoneyAnalyticsAction(period, facility),
    listLocationsAction(),
  ] as const);
  const terminology = await getTerminologyAction();
  const facilityName =
    facility && locations.status === "fulfilled"
      ? locations.value.find((l) => l.id === facility)?.name
      : undefined;

  const attendanceRows = settled(attendance, "Attendance by batch");
  const enquiryRows = settled(enquiry, "Enquiry funnel");
  const retentionReport = settled(retention, "Attendance records");
  const coachLoadRows = settled(coachLoad, "Coach load");
  const utilisationReport = settled(utilisation, "Facility utilisation");
  const operationalData = settled(operational, "Attendance and member mix");
  const moneyData = settled(money, "Collections and plan revenue");

  return (
    <OwnerPage>
      <PageHeader
        title="Reports"
        purpose={
          <>
            {isDefaultMonth ? "This calendar month: " : "Period: "}
            <span className="font-mono">
              {formatPeriodRangeIST(period.from, period.to)}
            </span>{" "}
            ({timezone}){facility ? ` · ${facilityName ?? "one facility"}` : ""}.
          </>
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/owner/reports/collections"
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Daily collections
        </Link>
        <Link
          href="/owner/fees"
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Fees &amp; payments
        </Link>
      </div>

      {facility ? (
        <p
          data-testid="reports-facility-note"
          className="mt-4 rounded-card border border-line bg-paper px-4 py-3 text-[12.5px] text-ink-2"
        >
          Showing <span className="font-medium">{facilityName ?? "one facility"}</span>.
          Attendance, collections and utilisation are scoped to it. Enquiry,
          attendance-record and coach-load reports are tenant-wide and are
          hidden while a facility is selected.
        </p>
      ) : null}

      {/* Key reports — two independent stacks for the same reason as
          the section below: a grid row takes the height of its tallest
          card, so the short coach-load card left a large hole under the
          tall enquiry funnel at 1280x900. The first stack carries the
          two figures an owner checks first (money, attendance); the
          second carries the demand behind them and the team that
          delivers it. The order is the same on the phone and on the
          desktop. When a facility is selected the tenant-wide cards
          are hidden, and then the section is one column rather than a
          column with a hole in it. */}
      <section
        aria-label="Key reports"
        data-report-key
        className={cn(
          "mt-5 grid items-start gap-5",
          facility ? "" : "lg:grid-cols-2",
        )}
      >
        <div className="space-y-5">
          {moneyData ? (
            <CollectionsExpensesCard series={moneyData.collections} />
          ) : (
            <ReportCardError title="Collections" />
          )}
          {attendanceRows ? (
            <AttendanceReportCard
              rows={attendanceRows}
              period={period}
              locationId={facility}
            />
          ) : (
            <ReportCardError title="Attendance by batch" />
          )}
        </div>
        {!facility ? (
          <div className="space-y-5">
            {enquiryRows ? (
              <EnquiryFunnelCard rows={enquiryRows} />
            ) : (
              <ReportCardError title="Enquiry funnel" />
            )}
            {coachLoadRows ? (
              <CoachLoadCard rows={coachLoadRows} />
            ) : (
              <ReportCardError title="Coach load" />
            )}
          </div>
        ) : null}
      </section>

      <SectionHeading title="More reports" className="mt-7" />
      {/* Two independent stacks instead of one grid of five cards.
          A grid row takes the height of its tallest card, so every
          shorter card left a hole under it — 87px under the member mix
          and 68px under the revenue card at 1280x900, against a
          declared 20px gap. The stacks flow on their own, grouped by
          the question they answer: attendance over time and attendance
          per member in the first, the club's people, revenue and spaces
          in the second. One markup, so the phone reads the same two
          groups in the same order. */}
      <div data-report-more className="mt-3 grid items-start gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {operationalData ? (
            <AttendanceTrendCard points={operationalData.attendanceTrend} />
          ) : (
            <ReportCardError title="Attendance trend" />
          )}
          {!facility && retentionReport ? (
            <RetentionCard
              report={retentionReport}
              memberLabel={resolveTerm(terminology, "member", "other")}
              memberLabelOne={resolveTerm(terminology, "member", 1)}
            />
          ) : !facility ? (
            <ReportCardError title="Attendance records" />
          ) : null}
        </div>
        <div className="space-y-5">
          {operationalData ? (
            <MemberMixCard
              slices={operationalData.memberMix}
              memberLabel={resolveTerm(terminology, "member", "other")}
            />
          ) : (
            <ReportCardError title="Members by status" />
          )}
          {moneyData ? (
            <PlanRevenueCard rows={moneyData.planRevenue} />
          ) : (
            <ReportCardError title="Revenue by plan" />
          )}
          {utilisationReport ? (
            <UtilisationCard report={utilisationReport} />
          ) : (
            <ReportCardError title="Facility utilisation" />
          )}
        </div>
      </div>
    </OwnerPage>
  );
}

function settled<T>(result: PromiseSettledResult<T>, title: string): T | null {
  if (result.status === "fulfilled") return result.value;
  console.error(`[owner/reports] ${title} failed to load`, result.reason);
  return null;
}
