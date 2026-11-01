import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { cashCounts } from "@/db/schema/cash-counts";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { writeAudit } from "@/lib/audit/write";
import {
  userLabel,
  userRoleNameFor,
  userNameFor,
} from "@/lib/services/payment-receiver";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { callerHasPermission } from "@/lib/services/resource-access";
import {
  getDailyCollection,
  REVIEW_THRESHOLD_PAISE,
  type CashCountRow,
  type CollectionGroup,
} from "@/lib/services/reconciliation";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// C-34 audit fix, Fix B's other half — split out of
// lib/services/reconciliation.ts (CLAUDE.md's 300-line guideline)
// once confirmCashCount's own policy gate (Fix A) pushed that file
// well past it. reopenCashCount is the only path back to an
// insertable state for an already-closed day: it supersedes the live
// row (status -> 'reopened', superseded_at stamped) rather than
// deleting or overwriting it, so it stays in history alongside
// whatever the next confirmCashCount call inserts — same append-only
// idiom as db/config.ts's config_values. listCashCountsNeedingReview
// (bottom of this file) is Fix A's dashboard query, added once
// REVIEW_THRESHOLD_PAISE existed to filter against.

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date.");

const reopenInput = z.object({
  locationId: z.string().uuid(),
  onDate: dateSchema,
  reason: z.string().trim().min(1).max(500),
});

export type ReopenCashCountResult =
  | { ok: true }
  | { ok: false; error: string };

const CASH_COUNT_REOPEN_ACTION = "cash_count.reopen";

export async function reopenCashCount(
  ctx: ActionCtx,
  raw: unknown,
): Promise<ReopenCashCountResult> {
  const parsed = reopenInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "A reason is required to reopen a count.",
    };
  }
  const { locationId, onDate, reason } = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, locationId)) {
      return { ok: false, error: "Location not found." };
    }

    const liveRows = await tx
      .select({
        id: cashCounts.id,
        countedPaise: cashCounts.countedPaise,
        systemPaise: cashCounts.systemPaise,
        variancePaise: cashCounts.variancePaise,
      })
      .from(cashCounts)
      .where(
        and(
          eq(cashCounts.tenantId, ctx.tenantId),
          eq(cashCounts.locationId, locationId),
          eq(cashCounts.onDate, onDate),
          isNull(cashCounts.supersededAt),
        ),
      )
      .for("update")
      .limit(1);
    const live = liveRows[0];
    if (!live) {
      return { ok: false, error: "No closed count for this day to reopen." };
    }

    const now = new Date();
    // The UPDATE is guarded by the same live-row condition the read
    // used: a second reopen (or a concurrent one that lost the lock)
    // matches NO row and is refused, so one reopen is one audit event
    // and one state change — never two.
    const reopened = await tx
      .update(cashCounts)
      .set({
        status: "reopened",
        supersededAt: now,
        reopenedBy: actorId,
        reopenedAt: now,
        reopenReason: reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(cashCounts.id, live.id),
          eq(cashCounts.tenantId, ctx.tenantId),
          isNull(cashCounts.supersededAt),
        ),
      )
      .returning({ id: cashCounts.id });
    if (reopened.length === 0) {
      return { ok: false, error: "No closed count for this day to reopen." };
    }

    // E-01 — the one audit writer: the reopen carries the request id.
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      action: CASH_COUNT_REOPEN_ACTION,
      entityType: "cash_count",
      entityId: live.id,
      before: {
        countedPaise: Number(live.countedPaise),
        systemPaise: Number(live.systemPaise),
        variancePaise: Number(live.variancePaise),
      },
      after: { reason },
      requestId: ctx.requestId ?? null,
    });

    return { ok: true };
  });
}

const historyInput = z.object({
  locationId: z.string().uuid(),
  onDate: dateSchema,
});

export type CashCountHistoryRow = {
  id: string;
  status: "closed" | "reopened";
  countedPaise: number;
  systemPaise: number;
  variancePaise: number;
  note: string | null;
  confirmedByName: string | null;
  confirmedAt: string;
  supersededAt: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
};

// The proof-of-history query: every row ever recorded for a
// tenant+location+day, oldest first, so a reopened count and its
// reclose are both independently visible — not just the latest.
export async function listCashCountHistory(
  ctx: ActionCtx,
  raw: unknown,
): Promise<CashCountHistoryRow[]> {
  const parsed = historyInput.safeParse(raw);
  if (!parsed.success) return [];
  const { locationId, onDate } = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, locationId)) return [];

    const rows = await tx
      .select({
        id: cashCounts.id,
        status: cashCounts.status,
        countedPaise: cashCounts.countedPaise,
        systemPaise: cashCounts.systemPaise,
        variancePaise: cashCounts.variancePaise,
        note: cashCounts.note,
        confirmedAt: cashCounts.confirmedAt,
        supersededAt: cashCounts.supersededAt,
        reopenedAt: cashCounts.reopenedAt,
        reopenReason: cashCounts.reopenReason,
        confirmerName: userNameFor(cashCounts.tenantId, cashCounts.confirmedBy),
        confirmerRole: userRoleNameFor(cashCounts.tenantId, cashCounts.confirmedBy),
        reopenerName: userNameFor(cashCounts.tenantId, cashCounts.reopenedBy),
        reopenerRole: userRoleNameFor(cashCounts.tenantId, cashCounts.reopenedBy),
      })
      .from(cashCounts)
      .where(
        and(
          eq(cashCounts.tenantId, ctx.tenantId),
          eq(cashCounts.locationId, locationId),
          eq(cashCounts.onDate, onDate),
        ),
      )
      .orderBy(cashCounts.confirmedAt);

    return rows.map((row) => ({
      id: row.id,
      status: row.status as "closed" | "reopened",
      countedPaise: Number(row.countedPaise),
      systemPaise: Number(row.systemPaise),
      variancePaise: Number(row.variancePaise),
      note: row.note,
      confirmedByName: userLabel(row.confirmerName, row.confirmerRole),
      confirmedAt: row.confirmedAt.toISOString(),
      supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
      reopenedByName: row.reopenedAt ? userLabel(row.reopenerName, row.reopenerRole) : null,
      reopenedAt: row.reopenedAt ? row.reopenedAt.toISOString() : null,
      reopenReason: row.reopenReason,
    }));
  });
}

// M01 (2026-10-09 role/content/permission audit §11) — reception's
// narrow close read. The counter holds payments.record and closes the
// day through confirmCashCount, but reports.financial (and the owner
// collections report) is not a counter grant. This summary returns
// only: the caller's assigned locations, tenant-local today, the
// per-method collected totals for each, and each location's live
// closed state with its counted/variance figure. No by-staff split, no
// café split, no dues/outstanding totals, no other location.
//
// The money math is not duplicated: each location's totals come from
// getDailyCollection (the same aggregation the owner report reads),
// then are narrowed into this DTO so report-only fields cannot leak.
export type ReceptionCloseLocation = {
  locationId: string;
  locationName: string;
  paymentCount: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  bankTransferPaise: number;
  methods: CollectionGroup[];
  closed: boolean;
  cashCount: CashCountRow | null;
};

export type ReceptionCloseSummary = {
  onDate: string;
  locations: ReceptionCloseLocation[];
};

export async function getReceptionCloseSummary(
  ctx: ActionCtx,
): Promise<ReceptionCloseSummary> {
  const scope = await withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerHasPermission(tx, ctx, "payments.record"))) {
      return { onDate: "", locations: [] as Array<{ id: string; name: string }> };
    }
    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(locations.tenantId, ctx.tenantId),
      isNull(locations.deletedAt),
    ];
    const predicate = locationPredicate(locations.id, access);
    if (predicate) conditions.push(predicate);

    const rows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(...conditions))
      .orderBy(asc(locations.name));

    return {
      onDate: todayInZone(tenantRow?.timezone ?? "Asia/Kolkata"),
      locations: rows,
    };
  });

  const summaries: ReceptionCloseLocation[] = [];
  for (const location of scope.locations) {
    const daily = await getDailyCollection(ctx, {
      onDate: scope.onDate,
      locationId: location.id,
    });
    const methodTotal = (key: string) =>
      daily.byMethod.find((method) => method.key === key)?.totalPaise ?? 0;
    summaries.push({
      locationId: location.id,
      locationName: location.name,
      paymentCount: daily.paymentCount,
      totalPaise: daily.totalPaise,
      cashPaise: daily.cashPaise,
      upiPaise: methodTotal("upi"),
      bankTransferPaise: methodTotal("bank_transfer"),
      methods: daily.byMethod,
      closed: daily.cashCount !== null,
      cashCount: daily.cashCount,
    });
  }

  return { onDate: scope.onDate, locations: summaries };
}

export type NeedsReviewCashCount = {
  locationId: string;
  locationName: string;
  onDate: string;
  variancePaise: number;
};

// Owner-dashboard surfacing for Fix A's >₹500 band. Tenant-wide
// (mirrors getOwnerDashboard, which is itself tenant-wide, not
// location-scoped by the caller's access grant) — every live cash
// count whose variance crosses the review threshold, most recent
// day first.
export async function listCashCountsNeedingReview(
  ctx: ActionCtx,
  limit = 10,
): Promise<NeedsReviewCashCount[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        locationId: cashCounts.locationId,
        locationName: locations.name,
        onDate: cashCounts.onDate,
        variancePaise: cashCounts.variancePaise,
      })
      .from(cashCounts)
      .innerJoin(locations, eq(locations.id, cashCounts.locationId))
      .where(
        and(
          eq(cashCounts.tenantId, ctx.tenantId),
          isNull(cashCounts.supersededAt),
          sql`abs(${cashCounts.variancePaise}) > ${REVIEW_THRESHOLD_PAISE}`,
        ),
      )
      .orderBy(desc(cashCounts.onDate))
      .limit(limit);

    return rows.map((row) => ({
      locationId: row.locationId,
      locationName: row.locationName,
      onDate: row.onDate,
      variancePaise: Number(row.variancePaise),
    }));
  });
}
