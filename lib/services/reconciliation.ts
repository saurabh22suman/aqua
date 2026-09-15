import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { cashCounts } from "@/db/schema/cash-counts";
import { tenants } from "@/db/schema/tenants";
import { locations } from "@/db/schema/locations";
import { auditLog } from "@/db/schema/audit";
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
import { dayRangeUtc } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// C-34 — the daily collection report and the cash count confirmation.
//
// Collections are aggregated from captured payments for the academy's
// local day (Asia/Kolkata by tenant default), by method and by the
// staff member who received them. The confirmation snapshots the
// system figure next to the physically counted cash so a variance
// stays explainable; a recount replaces the row (with an audit trail).

export type CollectionGroup = {
  key: string;
  label: string;
  count: number;
  totalPaise: number;
};

export type CashCountRow = {
  countedPaise: number;
  systemPaise: number;
  variancePaise: number;
  note: string | null;
  confirmedByName: string | null;
  confirmedAt: string;
};

export type DailyCollection = {
  onDate: string;
  totalPaise: number;
  paymentCount: number;
  cashPaise: number;
  byMethod: CollectionGroup[];
  byStaff: CollectionGroup[];
  cashCount: CashCountRow | null;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date.");

const dailyInput = z.object({
  onDate: dateSchema,
  locationId: z.string().uuid().optional(),
});

const methodLabels: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
};

export async function getDailyCollection(
  ctx: ActionCtx,
  raw: unknown,
): Promise<DailyCollection> {
  const parsed = dailyInput.safeParse(raw);
  if (!parsed.success) {
    return {
      onDate: "",
      totalPaise: 0,
      paymentCount: 0,
      cashPaise: 0,
      byMethod: [],
      byStaff: [],
      cashCount: null,
    };
  }
  const { onDate, locationId } = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (locationId && !locationVisible(access, locationId)) {
      return {
        onDate,
        totalPaise: 0,
        paymentCount: 0,
        cashPaise: 0,
        byMethod: [],
        byStaff: [],
        cashCount: null,
      };
    }

    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const { fromUtc, toUtc } = dayRangeUtc(
      onDate,
      tenantRow?.timezone ?? "Asia/Kolkata",
    );

    const conditions = [
      eq(payments.tenantId, ctx.tenantId),
      eq(payments.status, "captured"),
      gte(payments.receivedAt, fromUtc),
      lt(payments.receivedAt, toUtc),
    ];
    if (locationId) {
      conditions.push(eq(payments.locationId, locationId));
    } else {
      const predicate = locationPredicate(payments.locationId, access);
      if (predicate) conditions.push(predicate);
    }

    const rows = await tx
      .select({
        amountPaise: payments.amountPaise,
        method: payments.method,
        receivedBy: payments.receivedBy,
        receiverName: userNameFor(payments.tenantId, payments.receivedBy),
        receiverRole: userRoleNameFor(payments.tenantId, payments.receivedBy),
      })
      .from(payments)
      .where(and(...conditions));

    const byMethod = new Map<string, CollectionGroup>();
    const byStaff = new Map<string, CollectionGroup>();
    let totalPaise = 0;
    let cashPaise = 0;

    for (const row of rows) {
      const amount = Number(row.amountPaise);
      totalPaise += amount;
      if (row.method === "cash") cashPaise += amount;

      const method = byMethod.get(row.method) ?? {
        key: row.method,
        label: methodLabels[row.method] ?? row.method,
        count: 0,
        totalPaise: 0,
      };
      method.count += 1;
      method.totalPaise += amount;
      byMethod.set(row.method, method);

      const staffKey = row.receivedBy ?? "unknown";
      const staff = byStaff.get(staffKey) ?? {
        key: staffKey,
        label: userLabel(row.receiverName, row.receiverRole),
        count: 0,
        totalPaise: 0,
      };
      staff.count += 1;
      staff.totalPaise += amount;
      byStaff.set(staffKey, staff);
    }

    let cashCount: CashCountRow | null = null;
    if (locationId) {
      const countRows = await tx
        .select({
          countedPaise: cashCounts.countedPaise,
          systemPaise: cashCounts.systemPaise,
          variancePaise: cashCounts.variancePaise,
          note: cashCounts.note,
          confirmedAt: cashCounts.confirmedAt,
          confirmerName: userNameFor(cashCounts.tenantId, cashCounts.confirmedBy),
          confirmerRole: userRoleNameFor(cashCounts.tenantId, cashCounts.confirmedBy),
        })
        .from(cashCounts)
        .where(
          and(
            eq(cashCounts.tenantId, ctx.tenantId),
            eq(cashCounts.locationId, locationId),
            eq(cashCounts.onDate, onDate),
          ),
        )
        .limit(1);
      const row = countRows[0];
      if (row) {
        cashCount = {
          countedPaise: Number(row.countedPaise),
          systemPaise: Number(row.systemPaise),
          variancePaise: Number(row.variancePaise),
          note: row.note,
          confirmedByName: userLabel(row.confirmerName, row.confirmerRole),
          confirmedAt: row.confirmedAt.toISOString(),
        };
      }
    }

    return {
      onDate,
      totalPaise,
      paymentCount: rows.length,
      cashPaise,
      byMethod: [...byMethod.values()].sort((a, b) => b.totalPaise - a.totalPaise),
      byStaff: [...byStaff.values()].sort((a, b) => b.totalPaise - a.totalPaise),
      cashCount,
    };
  });
}

const confirmInput = z.object({
  locationId: z.string().uuid(),
  onDate: dateSchema,
  countedPaise: z.number().int().min(0).max(10_000_000_000),
  note: z.string().trim().min(1).max(500).optional(),
});

export type ConfirmCashCountResult =
  | { ok: true; variancePaise: number; systemPaise: number }
  | { ok: false; error: string };

const CASH_COUNT_ACTION = "cash_count.confirm";

export async function confirmCashCount(
  ctx: ActionCtx,
  raw: unknown,
): Promise<ConfirmCashCountResult> {
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid cash count.",
    };
  }
  const { locationId, onDate, countedPaise, note } = parsed.data;
  // Confirming a count is a counter action; the audit row below needs
  // a real actor.
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, locationId)) {
      return { ok: false, error: "Location not found." };
    }
    const locationRows = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(eq(locations.id, locationId), eq(locations.tenantId, ctx.tenantId)),
      )
      .limit(1);
    if (!locationRows[0]) return { ok: false, error: "Location not found." };

    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const { fromUtc, toUtc } = dayRangeUtc(
      onDate,
      tenantRow?.timezone ?? "Asia/Kolkata",
    );

    const cashRows = await tx
      .select({ amountPaise: payments.amountPaise })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, ctx.tenantId),
          eq(payments.status, "captured"),
          eq(payments.method, "cash"),
          eq(payments.locationId, locationId),
          gte(payments.receivedAt, fromUtc),
          lt(payments.receivedAt, toUtc),
        ),
      );
    const systemPaise = cashRows.reduce(
      (sum, row) => sum + Number(row.amountPaise),
      0,
    );
    const variancePaise = countedPaise - systemPaise;

    await tx
      .insert(cashCounts)
      .values({
        tenantId: ctx.tenantId,
        locationId,
        onDate,
        countedPaise: BigInt(countedPaise),
        systemPaise: BigInt(systemPaise),
        variancePaise: BigInt(variancePaise),
        note: note ?? null,
        confirmedBy: actorId,
      })
      .onConflictDoUpdate({
        target: [cashCounts.tenantId, cashCounts.locationId, cashCounts.onDate],
        set: {
          countedPaise: BigInt(countedPaise),
          systemPaise: BigInt(systemPaise),
          variancePaise: BigInt(variancePaise),
          note: note ?? null,
          confirmedBy: actorId,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorId,
      action: CASH_COUNT_ACTION,
      entityType: "cash_count",
      entityId: null,
      after: {
        locationId,
        onDate,
        countedPaise,
        systemPaise,
        variancePaise,
      },
    });

    return { ok: true, variancePaise, systemPaise };
  });
}
