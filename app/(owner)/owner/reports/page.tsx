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
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import Link from "next/link";

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
  const retentionReport = settled(retention, "Retention");
  const coachLoadRows = settled(coachLoad, "Coach load");
  const utilisationReport = settled(utilisation, "Facility utilisation");
  const operationalData = settled(operational, "Attendance and member mix");
  const moneyData = settled(money, "Collections and plan revenue");

  return (
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Reports</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        {isDefaultMonth ? "This calendar month: " : "Period: "}
        <span className="font-mono">
          {formatPeriodRangeIST(period.from, period.to)}
        </span>{" "}
        ({timezone}).
      </p>

      {facility ? (
        <p
          data-testid="reports-facility-note"
          className="mt-3 rounded-ctl border border-line bg-paper px-3.5 py-2.5 text-[12.5px] text-ink-2"
        >
          Showing <span className="font-medium">{facilityName ?? "one facility"}</span>.
          Attendance, collections and utilisation are scoped to it. Enquiry,
          retention and coach-load reports are tenant-wide and are hidden while
          a facility is selected.
        </p>
      ) : null}

      <Link
        href="/owner/reports/collections"
        className="mt-4 flex items-center justify-between rounded-card border border-line bg-paper px-3.5 py-3"
      >
        <span>
          <span className="block text-[14px] font-medium text-ink">
            Daily collections
          </span>
          <span className="block text-[12px] text-ink-3">
            Counter payments by method and staff, with the cash count.
          </span>
        </span>
        <span className="text-[13px] text-ink-3">→</span>
      </Link>

      <Link
        href="/owner/fees"
        className="mt-2 flex items-center justify-between rounded-card border border-line bg-paper px-3.5 py-3"
      >
        <span>
          <span className="block text-[14px] font-medium text-ink">
            Fees &amp; payments
          </span>
          <span className="block text-[12px] text-ink-3">
            Dues, transactions, invoices and plans in one hub.
          </span>
        </span>
        <span className="text-[13px] text-ink-3">→</span>
      </Link>

      {/* Owner UX audit (2026-10-24): the page stacked nine sections
          with no index, so the owner scrolled past several empty ones
          to find the one they wanted. The index below names what the
          page answers, and the cards sit under the same four headings
          so a report is findable by what it is about. */}
      <nav
        aria-label="Report index"
        className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {[
          { href: "#attendance", label: "Attendance" },
          { href: "#money", label: "Money" },
          { href: "#people", label: "People" },
          { href: "#enquiries", label: "Enquiries" },
        ].map((entry) => (
          <a
            key={entry.href}
            href={entry.href}
            className="flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3.5 text-[13px] font-medium"
          >
            {entry.label}
          </a>
        ))}
      </nav>

      <h2 id="attendance" className="font-display text-[15px] font-semibold mt-7 mb-2.5 scroll-mt-24">
        Attendance
      </h2>
      <div className="space-y-3">
        {attendanceRows ? (
          <AttendanceReportCard
            rows={attendanceRows}
            period={period}
            locationId={facility}
          />
        ) : (
          <ReportCardError title="Attendance by batch" />
        )}
        {operationalData ? (
          <AttendanceTrendCard points={operationalData.attendanceTrend} />
        ) : (
          <ReportCardError title="Attendance trend" />
        )}
        {utilisationReport ? (
          <UtilisationCard report={utilisationReport} />
        ) : (
          <ReportCardError title="Facility utilisation" />
        )}
      </div>

      <h2 id="money" className="font-display text-[15px] font-semibold mt-7 mb-2.5 scroll-mt-24">
        Money
      </h2>
      <div className="space-y-3">
        {moneyData ? (
          <CollectionsExpensesCard series={moneyData.collections} />
        ) : (
          <ReportCardError title="Collections" />
        )}
        {moneyData ? (
          <PlanRevenueCard rows={moneyData.planRevenue} />
        ) : (
          <ReportCardError title="Revenue by plan" />
        )}
      </div>

      <h2 id="people" className="font-display text-[15px] font-semibold mt-7 mb-2.5 scroll-mt-24">
        People
      </h2>
      <div className="space-y-3">
        {operationalData ? (
          <MemberMixCard
            slices={operationalData.memberMix}
            memberLabel={resolveTerm(terminology, "member", "other")}
          />
        ) : (
          <ReportCardError title="Members by status" />
        )}
        {!facility && retentionReport ? (
          <RetentionCard
            report={retentionReport}
            memberLabel={resolveTerm(terminology, "member", "other")}
            memberLabelOne={resolveTerm(terminology, "member", 1)}
          />
        ) : !facility ? (
          <ReportCardError title="Retention" />
        ) : null}
        {!facility && coachLoadRows ? (
          <CoachLoadCard rows={coachLoadRows} />
        ) : !facility ? (
          <ReportCardError title="Coach load" />
        ) : null}
      </div>

      {!facility ? (
        <>
          <h2 id="enquiries" className="font-display text-[15px] font-semibold mt-7 mb-2.5 scroll-mt-24">
            Enquiries
          </h2>
          <div className="space-y-3">
            {enquiryRows ? (
              <EnquiryFunnelCard rows={enquiryRows} />
            ) : (
              <ReportCardError title="Enquiry funnel" />
            )}
          </div>
        </>
      ) : null}
    </main>
  );
}

function settled<T>(result: PromiseSettledResult<T>, title: string): T | null {
  if (result.status === "fulfilled") return result.value;
  console.error(`[owner/reports] ${title} failed to load`, result.reason);
  return null;
}
