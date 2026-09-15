import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { cashCounts } from "@/db/schema/cash-counts";
import { auditLog } from "@/db/schema/audit";
import {
  userLabel,
  userRoleNameFor,
  userNameFor,
} from "@/lib/services/payment-receiver";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";

// C-34 audit fix, Fix B's other half — split out of
// lib/services/reconciliation.ts (CLAUDE.md's 300-line guideline)
// once confirmCashCount's own policy gate (Fix A, a later commit)
// pushed that file well past it. reopenCashCount is the only path
// back to an insertable state for an already-closed day: it
// supersedes the live row (status -> 'reopened', superseded_at
// stamped) rather than deleting or overwriting it, so it stays in
// history alongside whatever the next confirmCashCount call inserts
// — same append-only idiom as db/config.ts's config_values.

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
      .limit(1);
    const live = liveRows[0];
    if (!live) {
      return { ok: false, error: "No closed count for this day to reopen." };
    }

    const now = new Date();
    await tx
      .update(cashCounts)
      .set({
        status: "reopened",
        supersededAt: now,
        reopenedBy: actorId,
        reopenedAt: now,
        reopenReason: reason,
        updatedAt: now,
      })
      .where(eq(cashCounts.id, live.id));

    await tx.insert(auditLog).values({
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
