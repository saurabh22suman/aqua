import { and, eq, gte, isNull, lt } from "drizzle-orm";
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
// stays explainable.
//
// Audit fix (Fix B, this commit) — a live-attack audit found that a
// second confirm for the same tenant+location+day silently overwrote
// the row (hard unique key + onConflictDoUpdate); the prior value
// survived only as a separate audit_log row (entity_id null), never
// in the table itself. Fixed by a closed-state model: a "closed" day
// inserts a row and blocks a second confirm; reopenCashCount (in
// ./reconciliation-closed-state) is the only way back, and it
// supersedes rather than overwrites — same append-only idiom as
// db/config.ts's config_values (see db/schema/cash-counts.ts).
//
// A second problem the same audit found — no policy gate on variance
// size at all — is Fix A, a separate commit on top of this one.

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
      // Live row only (superseded_at is null) — Fix B. A reopened day
      // has no live row until it's re-confirmed, so the report
      // honestly shows "no count yet" in between, rather than a stale
      // superseded figure.
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
            isNull(cashCounts.supersededAt),
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

    // Fix B — a closed day cannot be silently overwritten. The only
    // way back to an insertable state is reopenCashCount, which
    // supersedes (not deletes) the live row below.
    const liveRows = await tx
      .select({ id: cashCounts.id })
      .from(cashCounts)
      .where(
        and(
          eq(cashCounts.tenantId, ctx.tenantId),
          eq(cashCounts.locationId, locationId),
          eq(cashCounts.onDate, onDate),
          isNull(cashCounts.supersededAt),
        ),
      )
      .limit(1);
    if (liveRows[0]) {
      return {
        ok: false,
        error: "This day is already closed. Reopen it first to recount.",
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

    let insertedId: string | undefined;
    try {
      const [inserted] = await tx
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
          status: "closed",
        })
        .returning({ id: cashCounts.id });
      insertedId = inserted?.id;
    } catch (err) {
      // The partial unique index (tenant, location, day) where
      // superseded_at is null surfaces as 23505 on a race between two
      // concurrent first-confirms — same walk-the-cause-chain shape
      // as lib/services/holidays.ts. Translate to the same "already
      // closed" result the pre-check above returns.
      let code: string | undefined = (err as { code?: string }).code;
      let cursor: unknown = err;
      while (!code && cursor && typeof cursor === "object" && "cause" in cursor) {
        cursor = (cursor as { cause: unknown }).cause;
        code = (cursor as { code?: string } | null)?.code;
      }
      if (code === "23505") {
        return {
          ok: false,
          error: "This day is already closed. Reopen it first to recount.",
        };
      }
      throw err;
    }

    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorId,
      action: CASH_COUNT_ACTION,
      entityType: "cash_count",
      entityId: insertedId ?? null,
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

// reopenCashCount and listCashCountHistory live in
// ./reconciliation-closed-state — split out once this file's own
// policy gate (Fix A, the next commit) pushed it past CLAUDE.md's
// 300-line guideline. Same module (C-34), same audit fix, just a
// second file.
