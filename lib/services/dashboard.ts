import { and, eq, exists, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { withTenant } from "@/db/tenant";
import { members } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import { memberFacilityOptins } from "@/db/schema/facility-optins";
import { tenants } from "@/db/schema/tenants";
import { batches, programs } from "@/db/schema/programs";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import { todayInZone, addDays } from "@/lib/time/tz";
import { listOverdueFollowUps } from "@/lib/services/enquiries";
import { getDailyCollection } from "@/lib/services/reconciliation";
import { getFeesOverview } from "@/lib/services/fees-hub";
import { listCashCountsNeedingReview } from "@/lib/services/reconciliation-closed-state";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { formatINR } from "@/lib/money/format";
import type { ActionCtx } from "@/lib/auth/context";

export type NeedsAttentionItem = {
  title: string;
  detail: string;
  href?: string;
};

export type TodaysLane = {
  batchId: string;
  batchName: string;
  programName: string;
  startTime: string;
  enrolled: number;
  capacity: number;
};

export type FacilityBreakdownRow = {
  locationId: string;
  locationName: string;
  activeMembers: number;
  attendancePct: number | null;
};

// C02 (docs/audits/2026-10-09-role-content-permission-audit.md §9) —
// the money/decision figures the owner home leads with. Every figure
// comes from an existing service (getDailyCollection for the day's
// captured payments, getFeesOverview for the invoice-side dues) under
// the caller's resolved location access, exactly like the rest of this
// read. No new money aggregate is computed here, and nothing is
// invented to fill a tile: zero is zero, due to the honest empty-state
// contract this screen already follows.
export type OwnerMoneySummary = {
  // Captured payments for the tenant-local day (gross; the same figure
  // the daily collections report and today's cash count reconcile).
  collectedTodayPaise: number;
  collectedTodayCount: number;
  // Issued/partial invoices still carrying a balance, all allowed sites.
  outstandingPaise: number;
  dueInvoiceCount: number;
  // The subset of those dues whose due date has already passed.
  overduePaise: number;
  overdueInvoiceCount: number;
};

export type OwnerDashboardData = {
  tenantName: string;
  today: string; // ISO date, tenant-timezone "today" -- the same value every other query below is scoped to
  todayMarked: number;
  todayTotal: number;
  activeMemberCount: number;
  attendanceThisWeekPct: number | null;
  activeBatchCount: number;
  needsAttention: NeedsAttentionItem[];
  todaysLanes: TodaysLane[];
  // C02 — collected today / outstanding / overdue, the figures the
  // owner home now leads with (periods stated in the labels there).
  money: OwnerMoneySummary;
  // W1-6 (docs/role-surfaces-plan.md) — consolidated per-facility view.
  // Wave 1 splits member-scoped data only: batches/sessions have no
  // location column yet, so attendance here is grouped by each
  // member's home facility (Wave 2 adds batch.location_id).
  facilityBreakdown: FacilityBreakdownRow[];
};

// S4 (Owner home), not C-46 as literally specified: C-46 wants an
// overdue-amount hero and a "collected this month" chip, but no money
// table exists anywhere in this codebase yet (C-28 through C-39 are
// all unbuilt). S4's own Build text is explicit and different --
// "today's batches as capacity lanes, member count, attendance this
// week, needs-attention list... NO money tiles, no placeholders for
// absent data -- honest empty states" -- and that's what this builds.
// Every figure here comes from a real query against data that exists
// today (sessions, attendance, batches, enrolments, members). Nothing
// is invented to fill a slot the mockup happens to have.
//
// Still no money tiles (this update only adds overdue follow-ups,
// C-13's own done-when: "overdue follow-ups surface on the owner
// dashboard"). listOverdueFollowUps opens its own withTenant() and
// withTenant() cannot nest (db/scope.ts) -- called here, before the
// dashboard's own withTenant() below, not inside it.
// W1-6 continuation — when the owner has picked a facility in the
// global switcher, every site-scoped figure on the dashboard is
// restricted to it. Tenant-wide signals that have no location column
// (enquiry follow-ups) are shown only in the All-facilities view:
// surfacing them under a single-site heading would attach the wrong
// context to real work. Cash counts carry a location and are filtered.
//
// A07 (docs/audits/2026-10-09-role-content-permission-audit.md) — the
// dashboard previously honoured only the optional facility argument and
// never consulted the caller's enforced location access, so a restricted
// Admin received every site's aggregate, breakdown and attention rows
// through the tenant-only action adapter. The access boundary now comes
// from resolveLocationAccess (the same gate other scoped service reads
// use) and intersects with the facility choice, so a request can only
// narrow — never widen — what the caller is allowed to see.
export type OwnerDashboardOptions = { locationId?: string };

export async function getOwnerDashboard(
  ctx: ActionCtx,
  options: OwnerDashboardOptions = {},
): Promise<OwnerDashboardData> {
  const requestedLocationId = options.locationId;
  // Same reason the sibling reads below live outside the dashboard's own
  // transaction: withTenant() cannot nest (db/scope.ts). One short
  // config/membership read, then every query inside the main transaction
  // uses the resolved boundary. The tenant read rides along so the
  // money reads below can be pinned to the tenant-local day before the
  // main transaction opens.
  const { access, timezone, tenantName } = await withTenant(
    ctx.tenantId,
    async (tx) => {
      const access = await resolveLocationAccess(tx, ctx);
      const [tenant] = await tx
        .select({ timezone: tenants.timezone, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));
      return { access, timezone: tenant.timezone, tenantName: tenant.name };
    },
  );
  const today = todayInZone(timezone);

  // Follow-ups carry no location column and cannot be sliced per site; an
  // unrestricted caller without a facility filter still gets them, and a
  // narrowed view (facility choice or restricted access) does not.
  const overdueFollowUps =
    access.unrestricted && !requestedLocationId
      ? await listOverdueFollowUps(ctx)
      : [];
  // C-34 audit fix, Fix A's dashboard surfacing — a cash count closed
  // with a variance over ₹500 needs a human to look at it. Its own
  // withTenant() call, same reason listOverdueFollowUps is fetched up
  // here rather than inside the dashboard's own transaction below
  // (withTenant cannot nest — db/scope.ts). Cash counts carry a location,
  // so both the facility choice and the access boundary apply.
  const reviewCashCounts = (await listCashCountsNeedingReview(ctx)).filter(
    (c) =>
      (!requestedLocationId || c.locationId === requestedLocationId) &&
      locationVisible(access, c.locationId),
  );

  // C02 — the four figures the hero leads with, delegated to the
  // existing services so their definitions (captured status, invoice
  // balance gate, tenant-local day window) stay the single source. The
  // facility choice and the enforced access boundary flow through the
  // same resolveLocationAccess those services share with this one, so
  // these reads can only narrow — never widen — the caller's view.
  const [dailyCollection, feesOverview] = await Promise.all([
    getDailyCollection(
      ctx,
      requestedLocationId
        ? { onDate: today, locationId: requestedLocationId }
        : { onDate: today },
    ),
    getFeesOverview(
      ctx,
      { from: today, to: addDays(today, 1) },
      requestedLocationId ? { locationId: requestedLocationId } : {},
    ),
  ]);
  const money: OwnerMoneySummary = {
    collectedTodayPaise: dailyCollection.totalPaise,
    collectedTodayCount: dailyCollection.paymentCount,
    outstandingPaise: feesOverview.outstandingPaise,
    dueInvoiceCount: feesOverview.dueInvoiceCount,
    overduePaise: feesOverview.overduePaise,
    overdueInvoiceCount: feesOverview.overdueInvoiceCount,
  };

  return withTenant(ctx.tenantId, async (tx) => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Every location-shaped read below intersects two predicates: the
    // caller's explicit facility choice (if any) and the enforced access
    // boundary. ANDing them means a facility request can only narrow the
    // allowed set — never widen it.
    const locationCondition = (column: PgColumn): SQL | undefined => {
      const parts: SQL[] = [];
      if (requestedLocationId) parts.push(eq(column, requestedLocationId));
      const accessPredicate = locationPredicate(column, access);
      if (accessPredicate) parts.push(accessPredicate);
      return parts.length === 0 ? undefined : and(...parts);
    };

    const memberOptinExists = (locationIds: string[]) =>
      exists(
        tx
          .select({ one: sql`1` })
          .from(memberFacilityOptins)
          .where(
            and(
              eq(memberFacilityOptins.memberId, members.id),
              inArray(memberFacilityOptins.locationId, locationIds),
              isNull(memberFacilityOptins.endedOn),
            ),
          ),
      );

    // Members count when they belong to a location by home or by an
    // active opt-in; both halves are held to the same boundary.
    const memberCondition = (): SQL | undefined => {
      const parts: SQL[] = [];
      if (requestedLocationId) {
        parts.push(
          or(
            eq(members.locationId, requestedLocationId),
            memberOptinExists([requestedLocationId]),
          )!,
        );
      }
      if (!access.unrestricted) {
        const home = locationPredicate(members.locationId, access)!;
        parts.push(
          access.locationIds.length === 0
            ? home
            : or(home, memberOptinExists(access.locationIds))!,
        );
      }
      return parts.length === 0 ? undefined : and(...parts);
    };

    const [{ n: activeMemberCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(
        and(
          eq(members.tenantId, ctx.tenantId),
          eq(members.status, "active"),
          isNull(members.deletedAt),
          memberCondition(),
        ),
      );

    const [{ n: activeBatchCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, ctx.tenantId),
          isNull(batches.deletedAt),
          locationCondition(batches.locationId),
        ),
      );

    // Today's sessions across every batch, joined to their attendance
    // counts and enrolment counts -- the one query everything else in
    // this function is derived from, so "today" and "enrolled" can
    // never drift between the register card, the needs-attention check
    // and the lane list. Cancelled sessions are excluded: a batch that
    // is not happening today is not a lane and needs no register (the
    // same `status <> 'cancelled'` gate the analytics and schedule
    // reads apply).
    const todaysSessions = await tx
      .select({
        sessionId: sessions.id,
        batchId: sessions.batchId,
        batchName: batches.name,
        programName: programs.name,
        startTime: batches.startTime,
        startsAt: sessions.startsAt,
        capacity: batches.capacity,
        marked: sql<number>`(select count(*)::int from ${attendance} a where a.session_id = ${sessions.id})`,
        enrolled: sql<number>`(select count(distinct e.member_id)::int from ${enrolments} e where e.batch_id = ${sessions.batchId} and e.tenant_id = ${ctx.tenantId})`,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .innerJoin(programs, eq(programs.id, batches.programId))
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          eq(sessions.sessionDate, today),
          sql`${sessions.status} <> 'cancelled'`,
          locationCondition(batches.locationId),
        ),
      )
      .orderBy(sessions.startsAt);

    const now = Date.now();
    const todayMarked = todaysSessions.reduce((sum, s) => sum + s.marked, 0);
    const todayTotal = todaysSessions.reduce((sum, s) => sum + s.enrolled, 0);

    // Needs attention, C02 priority order: cash discrepancies first
    // (money that does not add up), then the billing decision (overdue
    // fees), then unresolved follow-ups, then register execution
    // ("a session that has already started, has real enrolled members
    // to mark, and has zero marks yet"). A batch with no one enrolled
    // is not flagged -- there is nothing for a coach to have done. The
    // register signal is the one honestly detectable from today's
    // schema; see docs/architecture.md for what's deferred (an
    // unassigned/"uncovered" batch needs sessions.coach_id, only on
    // the not-yet-merged coach-assignment-scoping branch).
    const needsAttention: NeedsAttentionItem[] = [];

    // C-34 audit fix, Fix A — a cash count closed with a variance
    // over ₹500 needs a human to look at it, not just a database row
    // nobody reads. Same reason-stated shape as every other
    // needs-attention item; the collections report reconciles it.
    for (const c of reviewCashCounts) {
      const direction = c.variancePaise < 0 ? "short" : "over";
      needsAttention.push({
        title: "Cash count needs review",
        detail: `${c.locationName} — ${c.onDate}: ${formatINR(Math.abs(c.variancePaise))} ${direction}`,
        // PR3-C3 — the collections report is where the count and its
        // variance are reconciled.
        href: "/owner/reports/collections",
      });
    }

    // C02 — overdue fees were previously invisible on the owner home
    // until someone opened the Fees hub. The figure is the same
    // getFeesOverview the hub shows; the row states the amount and the
    // invoice count so the owner can decide, not just tally.
    if (money.overdueInvoiceCount > 0) {
      needsAttention.push({
        title: "Overdue fees",
        detail: `${formatINR(money.overduePaise)} across ${money.overdueInvoiceCount} invoice${
          money.overdueInvoiceCount === 1 ? "" : "s"
        } past the due date`,
        href: "/owner/fees?tab=dues",
      });
    }

    // C-13 done-when: "overdue follow-ups surface on the owner
    // dashboard." Every item still states why it's here -- how many
    // days overdue, and the enquiry it belongs to -- not a bare count.
    for (const f of overdueFollowUps) {
      const daysOverdue = Math.max(1, Math.floor((now - f.dueAt.getTime()) / (24 * 60 * 60 * 1000)));
      needsAttention.push({
        title: "Follow-up overdue",
        detail: `${f.enquiryName} — due ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago${f.note ? `: ${f.note}` : ""}`,
        href: `/owner/enquiries/${f.enquiryId}`,
      });
    }

    for (const s of todaysSessions) {
      if (s.enrolled > 0 && s.marked === 0 && s.startsAt.getTime() < now) {
        needsAttention.push({
          title: "Register not started",
          detail: `${s.batchName} — session began, nothing marked yet`,
          // PR3-C3 — every attention row links somewhere the owner can
          // look; the attendance report shows this batch's marks.
          href: "/owner/reports",
        });
      }
    }

    const todaysLanes: TodaysLane[] = todaysSessions.map((s) => ({
      batchId: s.batchId,
      batchName: s.batchName,
      programName: s.programName,
      startTime: s.startTime,
      enrolled: s.enrolled,
      capacity: s.capacity,
    }));

    // Attendance this week: present+late over total marks in the last
    // 7 days. Null (not 0) when there are no marks yet at all -- an
    // honest "no data" is different from "0% attendance", and the UI
    // must show them differently (see S4's own done-when: truthful
    // about emptiness, not a fabricated zero).
    const [weekRow] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        present: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
      })
      .from(attendance)
      .where(
        and(
          eq(attendance.tenantId, ctx.tenantId),
          gte(attendance.markedAt, weekAgo),
          locationCondition(attendance.locationId),
        ),
      );
    const attendanceThisWeekPct =
      weekRow.total > 0 ? Math.round((weekRow.present / weekRow.total) * 100) : null;

    // W1-6 / Wave 2 — per-facility consolidation. Every live location
    // is listed. Active members = home-facility members + active
    // opt-ins (a member training at two facilities counts at both).
    // Attendance is grouped by the batch's facility — the session's
    // real location — not the member's home facility as in Wave 1.
    const locationRows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.tenantId, ctx.tenantId), isNull(locations.deletedAt)))
      .orderBy(locations.name);

    const homeCounts = await tx
      .select({
        locationId: members.locationId,
        n: sql<number>`count(*)::int`,
      })
      .from(members)
      .where(
        and(
          eq(members.tenantId, ctx.tenantId),
          eq(members.status, "active"),
          isNull(members.deletedAt),
          locationCondition(members.locationId),
        ),
      )
      .groupBy(members.locationId);

    const optinCounts = await tx
      .select({
        locationId: memberFacilityOptins.locationId,
        n: sql<number>`count(*)::int`,
      })
      .from(memberFacilityOptins)
      .where(
        and(
          eq(memberFacilityOptins.tenantId, ctx.tenantId),
          isNull(memberFacilityOptins.endedOn),
          locationCondition(memberFacilityOptins.locationId),
        ),
      )
      .groupBy(memberFacilityOptins.locationId);

    const attendanceCounts = await tx
      .select({
        locationId: batches.locationId,
        total: sql<number>`count(*)::int`,
        present: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          eq(attendance.tenantId, ctx.tenantId),
          gte(attendance.markedAt, weekAgo),
          locationCondition(batches.locationId),
        ),
      )
      .groupBy(batches.locationId);

    const homeBy = new Map(homeCounts.map((r) => [r.locationId, r.n]));
    const optinBy = new Map(optinCounts.map((r) => [r.locationId, r.n]));
    const marksBy = new Map(
      attendanceCounts
        .filter((r) => r.locationId !== null)
        .map((r) => [r.locationId as string, r]),
    );

    const facilityBreakdown: FacilityBreakdownRow[] = locationRows
      .filter(
        (l) =>
          (!requestedLocationId || l.id === requestedLocationId) &&
          locationVisible(access, l.id),
      )
      .map((l) => {
      const marks = marksBy.get(l.id);
      return {
        locationId: l.id,
        locationName: l.name,
        activeMembers: (homeBy.get(l.id) ?? 0) + (optinBy.get(l.id) ?? 0),
        attendancePct:
          marks && marks.total > 0
            ? Math.round((marks.present / marks.total) * 100)
            : null,
      };
    });

    return {
      tenantName,
      today,
      todayMarked,
      todayTotal,
      activeMemberCount,
      attendanceThisWeekPct,
      activeBatchCount,
      needsAttention,
      todaysLanes,
      money,
      facilityBreakdown,
    };
  });
}
