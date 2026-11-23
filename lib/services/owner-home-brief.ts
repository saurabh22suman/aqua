import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { addDays, formatDateIST, formatWallTime24hIST, todayInZone } from "@/lib/time/tz";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { getFeesOverview } from "@/lib/services/fees-hub";
import type { ActionCtx } from "@/lib/auth/context";
import type { BrandingData } from "@/lib/services/branding";
import type {
  NeedsAttentionItem,
  NextClass,
  OwnerDashboardData,
} from "@/lib/services/dashboard";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { NeedsReviewCashCount } from "@/lib/services/reconciliation-closed-state";

// 21 November 2026 — Owner Home brief.
//
// This module is the narrow read model between the existing scoped dashboard,
// collection-chart and fees services and the approved mobile composition. It
// adds NO query of its own for the main figures: the page already loads the
// dashboard and the last-seven-day chart under the caller's permissions and
// location access. The one extra read is the small, deferred by-facility
// comparison, which reuses getFeesOverview for each already-authorized site.
//
// Money stays integer paise in this model. Whole-rupee formatting happens at
// the display boundary only (lib/money/format.ts).

export type OwnerBriefFacility = { id: string; name: string };

export type OwnerBriefDay = {
  key: string;
  /** Axis label, e.g. "15". */
  shortLabel: string;
  /** Accessible label, e.g. "15 Nov 2026". */
  fullLabel: string;
  paise: number;
  paymentCount?: number;
};

export type OwnerBriefMoney = {
  /** Captured payments in the one stated seven-day window. Null = read failed. */
  last7Paise: number | null;
  todayPaise: number;
  outstandingPaise: number;
  overduePaise: number;
  overdueInvoiceCount: number;
  oldestOverdueDays: number | null;
  days: OwnerBriefDay[];
  periodLabel: string;
  todayCount: number;
};

export type OwnerBriefSession = {
  timeLabel: string;
  title: string;
  detail: string | null;
  href: string;
  isNextDay: boolean;
  id?: string;
  statusLabel?: string;
};

export type OwnerBriefView = {
  facilityId: string | null;
  scopeLabel: string;
  facilities: OwnerBriefFacility[];
  multiFacility: boolean;
  tenantShortName: string;
  dateLabel: string;
  todayIso: string;
  money: OwnerBriefMoney | null;
  cashReview: NeedsReviewCashCount | null;
  followUps: { count: number; href: string; label: string; detail: string } | null;
  session: OwnerBriefSession | null;
  upcomingSessions?: OwnerBriefSession[];
  scheduleHref: string;
  membersHref: string;
  enquiriesHref: string;
  feesHref: string;
  overdueHref: string;
  cashHref: string;
  can: {
    fees: boolean;
    schedule: boolean;
    enquiries: boolean;
  };
};

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function shortDate(dateIso: string): string {
  const [, month, day] = dateIso.split("-");
  return `${Number(day)} ${MONTH_SHORT[Number(month) - 1] ?? ""}`.trim();
}

/** "15–21 Nov 2026" when both dates are in one month, else both dates stated. */
export function formatBriefPeriod(fromIso: string, toIso: string): string {
  const [fromYear, fromMonth, fromDay] = fromIso.split("-");
  const [toYear, toMonth, toDay] = toIso.split("-");
  const month = MONTH_SHORT[Number(toMonth) - 1] ?? "";
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${Number(fromDay)}–${Number(toDay)} ${month} ${toYear}`;
  }
  return `${shortDate(fromIso)} ${fromYear} – ${shortDate(toIso)} ${toYear}`;
}

function longDate(dateIso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${dateIso}T00:00:00Z`));
}

function wallTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return value;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function sessionTime(instant: string | Date | undefined, fallback: string): string {
  if (instant) {
    const date = instant instanceof Date ? instant : new Date(instant);
    if (!Number.isNaN(date.getTime())) {
      return formatWallTime24hIST(date);
    }
  }
  return wallTime(fallback);
}

function upcomingSessions(data: OwnerDashboardData, facilityId: string | null): OwnerBriefSession[] {
  return data.todaysLanes
    .filter(entry => !entry.started && entry.status !== "cancelled" && entry.status !== "completed")
    .slice(0, 2)
    .map(lane => ({
      id: lane.sessionId,
      timeLabel: sessionTime(lane.startsAt, lane.startTime),
      title: lane.batchName,
      detail: [lane.locationName, lane.coachName].filter(Boolean).join(" · ") || null,
      href: scheduleHref(data.today, facilityId),
      isNextDay: false,
    }));
}

function nextSession(
  data: OwnerDashboardData,
  facilityId: string | null,
  upcoming: OwnerBriefSession[],
): OwnerBriefSession | null {
  if (upcoming[0]) return upcoming[0];
  const next: NextClass | null = data.nextClass;
  if (!next) return null;
  return {
    timeLabel: sessionTime(next.startsAt, next.startTime),
    title: next.batchName,
    detail: [formatDateIST(next.sessionDate), next.coachName]
      .filter(Boolean)
      .join(" · "),
    href: scheduleHref(next.sessionDate, facilityId),
    isNextDay: next.sessionDate !== data.today,
  };
}

function scheduleHref(dateIso: string, facilityId: string | null): string {
  return `/owner/schedule?${new URLSearchParams({
    date: dateIso,
    facility: facilityId ?? "all",
  }).toString()}`;
}

function followUps(
  attention: NeedsAttentionItem[],
): OwnerBriefView["followUps"] {
  const rows = attention.filter(
    (item) => item.title === "Follow-up overdue" || item.title.toLowerCase().includes("follow-up"),
  );
  if (rows.length === 0) return null;
  const first = rows[0]!;
  return {
    count: rows.length,
    href: rows.length === 1 ? first.href ?? "/owner/enquiries" : "/owner/enquiries",
    label: `${rows.length} overdue enquiry ${rows.length === 1 ? "follow-up" : "follow-ups"}`,
    detail: rows.length === 1 ? first.detail : "Review in Enquiries",
  };
}

export function buildOwnerHomeBriefView({
  data,
  charts,
  facilities,
  branding,
  requestedFacility,
  can,
}: {
  data: OwnerDashboardData;
  charts: OwnerChartsData | null;
  facilities: OwnerBriefFacility[];
  branding: BrandingData;
  requestedFacility: string | null;
  can: OwnerBriefView["can"];
}): OwnerBriefView {
  const facilityId = requestedFacility ?? null;
  const scopeLabel =
    (facilityId ? facilities.find((entry) => entry.id === facilityId)?.name : null) ??
    (facilities.length > 1 ? "All facilities" : facilities[0]?.name) ??
    data.scopeLocationName ??
    "All facilities";

  const days: OwnerBriefDay[] =
    charts?.collections.buckets.map((bucket) => ({
      key: bucket.key,
      shortLabel: String(Number(bucket.key.slice(8))),
      fullLabel: bucket.fullLabel,
      paise: bucket.totalPaise,
      paymentCount: bucket.paymentCount,
    })) ?? [];

  const money: OwnerBriefMoney | null = can.fees && data.money
    ? {
        last7Paise: charts ? charts.collections.totalPaise : null,
        todayPaise:
          days.find((day) => day.key === data.today)?.paise ??
          data.money.collectedTodayPaise,
        outstandingPaise: data.money.outstandingPaise,
        overduePaise: data.money.overduePaise,
        overdueInvoiceCount: data.money.overdueInvoiceCount,
        oldestOverdueDays: data.money.oldestOverdueDays ?? null,
        days,
        periodLabel: charts
          ? formatBriefPeriod(charts.period.currentFromDate, charts.period.currentToDate)
          : formatBriefPeriod(addDays(data.today, -6), data.today),
        todayCount: data.money.collectedTodayCount,
      }
    : null;

  const upcoming = can.schedule ? upcomingSessions(data, facilityId) : [];

  return {
    facilityId,
    scopeLabel,
    facilities,
    multiFacility: facilities.length > 1,
    tenantShortName:
      branding.shortName?.trim() ||
      branding.fallbackShortName ||
      data.tenantName,
    dateLabel: longDate(data.today),
    todayIso: data.today,
    money,
    cashReview: can.fees ? data.cashReview ?? null : null,
    followUps: can.enquiries ? followUps(data.needsAttention) : null,
    session: can.schedule ? nextSession(data, facilityId, upcoming) : null,
    upcomingSessions: upcoming,
    scheduleHref: scheduleHref(data.today, facilityId),
    membersHref: `/owner/members?facility=${facilityId ?? "all"}`,
    enquiriesHref: "/owner/enquiries",
    feesHref: `/owner/fees?facility=${facilityId ?? "all"}`,
    overdueHref: `/owner/fees?${new URLSearchParams({
      tab: "dues",
      overdue: "1",
      facility: facilityId ?? "all",
    }).toString()}`,
    cashHref: `/owner/reports/collections?${new URLSearchParams(data.cashReview
      ? { facility: data.cashReview.locationId, date: data.cashReview.onDate }
      : { facility: facilityId ?? "all" })}`,
    can,
  };
}

/** The live, authorized named facilities this caller may choose from. */
export async function listOwnerBriefFacilities(
  ctx: ActionCtx,
): Promise<OwnerBriefFacility[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.tenantId, ctx.tenantId), isNull(locations.deletedAt)))
      .orderBy(locations.name);
    return rows.filter((row) => locationVisible(access, row.id));
  });
}

export type OwnerBriefFacilityMoney = {
  id: string;
  name: string;
  recordedPaise: number;
  recordedCount: number;
  outstandingPaise: number;
  overduePaise: number;
};

/**
 * The deferred "By facility" comparison. It reads only the caller's live,
 * authorized sites and reuses the Fees overview's own period/outstanding
 * definitions. It is not part of the first Home read.
 */
export async function getOwnerHomeFacilityMoney(
  ctx: ActionCtx,
): Promise<OwnerBriefFacilityMoney[]> {
  const { facilities, today } = await withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const rows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.tenantId, ctx.tenantId), isNull(locations.deletedAt)))
      .orderBy(locations.name);
    return {
      facilities: rows.filter((row) => locationVisible(access, row.id)),
      today: todayInZone(tenant?.timezone ?? "Asia/Kolkata"),
    };
  });
  const from = addDays(today, -6);
  const to = addDays(today, 1);
  return Promise.all(
    facilities.map(async (facility) => {
      const overview = await getFeesOverview(ctx, { from, to }, { locationId: facility.id });
      return {
        id: facility.id,
        name: facility.name,
        recordedPaise: overview.collectedPaise,
        recordedCount: overview.paymentCount,
        outstandingPaise: overview.outstandingPaise,
        overduePaise: overview.overduePaise,
      };
    }),
  );
}
