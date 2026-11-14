import { cookies } from "next/headers";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature } from "@/lib/auth/permission";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import { getOwnerInsightsAttendanceAction } from "@/lib/actions/owner-insights";
import { ownerInsightInputSchema, type AttendanceByBatchInsight } from "@/lib/services/owner-insights";
import { parseCalendarDate } from "@/lib/time/calendar";
import { addDays, formatPeriodRangeIST } from "@/lib/time/tz";
import { isOwnerPeriodKey, resolveOwnerPeriod } from "@/lib/time/owner-periods";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttendanceRange } from "@/components/reports/owner-approved/attendance-range";
import { AttendanceResults } from "@/components/reports/owner-approved/attendance-results";
import { z } from "zod";

type Params = { from?: string; to?: string; facility?: string; period?: string; batch?: string };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  const params = await searchParams;
  const cookieStore = await cookies();
  const facility = resolveFacilityValue(params.facility, cookieStore.get(FACILITY_COOKIE)?.value);
  const facilityScope = params.facility === "all" ? "all" : facility;
  const reportsHref = facilityScope ? `/owner/reports?${new URLSearchParams({ facility: facilityScope })}` : "/owner/reports";
  const isCustom = params.period === "custom" || (!params.period && (params.from !== undefined || params.to !== undefined));
  const invalidPeriod = (params.period !== undefined && params.period !== "custom" && !isOwnerPeriodKey(params.period)) ||
    (isOwnerPeriodKey(params.period) && (params.from !== undefined || params.to !== undefined));
  const period = resolveOwnerPeriod(isOwnerPeriodKey(params.period) ? params.period : "last7").current;
  const from = isCustom ? params.from ?? "" : period.fromDate;
  const inclusiveTo = isCustom ? params.to ?? "" : period.toDate;
  const validDates = Boolean(parseCalendarDate(from) && parseCalendarDate(inclusiveTo) && inclusiveTo >= from);
  const parsed = validDates ? ownerInsightInputSchema.safeParse({ from, to: addDays(inclusiveTo, 1), ...(facility ? { locationId: facility } : {}) }) : null;
  const invalid = invalidPeriod || !parsed?.success || (params.batch !== undefined && !z.string().uuid().safeParse(params.batch).success);
  let data: AttendanceByBatchInsight | null = null;
  let failed = false;
  if (!invalid && hasFeature(ctx, "reports") && parsed.success) {
    try { data = await getOwnerInsightsAttendanceAction(parsed.data); } catch { failed = true; }
  }
  const batch = params.batch && data ? data.rows.find((row) => row.batchId === params.batch) : undefined;
  const displayed = params.batch && data && batch ? { ...data, rows:[batch], summary:{sessions:batch.sessions,marks:batch.marks,shares:batch.shares,register:batch.register} } : data;
  return <OwnerPage>
    <BackLink href={reportsHref} label="All reports" />
    <PageHeader title="Attendance report" />
    <AttendanceRange period={isCustom ? "custom" : isOwnerPeriodKey(params.period) ? params.period : "last7"} from={from} to={inclusiveTo} facility={facilityScope} />
    {invalid ? <p role="alert" className="mt-4 text-sm text-ink-2">Invalid report scope. Choose a valid date range and group.</p> : !hasFeature(ctx, "reports") ? <p role="alert" className="mt-4 text-sm text-ink-2">Reports are unavailable.</p> : failed ? <p role="alert" className="mt-4 text-sm text-ink-2">Attendance could not load. Please try again.</p> : params.batch && data && !batch ? <p className="mt-4 text-sm text-ink-2">No attendance evidence is available for this group in the selected scope.</p> : displayed ? <>
      <p className="mt-4 text-sm text-ink-2">{formatPeriodRangeIST(displayed.from, displayed.to)}{facility ? " · Selected facility" : " · All permitted facilities"}</p>
      <AttendanceResults data={displayed} />
    </> : null}
  </OwnerPage>;
}
