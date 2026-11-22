import { cookies } from "next/headers";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import { isOwnerPeriodKey, resolveOwnerPeriod } from "@/lib/time/owner-periods";

export type ReportParams = { period?: string; facility?: string };
export async function reportScope(searchParams?: Promise<ReportParams>) {
  const params = searchParams ? await searchParams : {};
  const store = await cookies();
  const period = isOwnerPeriodKey(params.period) ? params.period : "last7";
  const facility = params.facility === "all" ? undefined : resolveFacilityValue(params.facility, store.get(FACILITY_COOKIE)?.value);
  const window = resolveOwnerPeriod(period).current;
  return { period, facility, facilityParam: params.facility === "all" ? "all" : facility, from: window.fromDate, to: window.toDate };
}
