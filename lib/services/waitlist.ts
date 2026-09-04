import { and, asc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { waitlistEntries } from "@/db/schema/waitlist-entries";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import { z } from "zod";

// Phase R.5 — waitlist. A member joins a queue for a full
// batch; on a slot opening, the head of the queue is auto-
// promoted. R.5's hard delivery: "a member joins a queue when
// capacity is hit and auto-enrols on the next withdrawal. In-app
// notification on promotion; WhatsApp excluded."
//
// Position is FIFO: the (tenant, batch, position) index is the
// queue head. New entries go to position = max+1; promotion
// takes position=1; on cancel/expiry, remaining positions
// re-index. Re-indexing is done in the service rather than the
// schema to keep the SQL simple.

export type WaitlistResult =
  | { kind: "ok"; entryId: string; position: number }
  | {
      kind: "error";
      code:
        | "invalid"
        | "already_on_waitlist"
        | "not_on_waitlist"
        | "not_waiting";
      message: string;
    };

const addSchema = z.object({
  memberId: z.string().uuid(),
  batchId: z.string().uuid(),
});

export async function addToWaitlist(
  ctx: ActionCtx,
  raw: unknown,
): Promise<WaitlistResult> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid waitlist request." };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    // Refuse if the member is already enrolled in the batch.
    // (The unique partial on (member, batch) where status='waiting'
    // catches double-add; the live-enrolment check is the
    // friendlier failure mode.)
    const enrolled = await tx.execute<{ id: string }>(sql`
      select id from enrolments
      where tenant_id = ${ctx.tenantId}
        and member_id = ${parsed.data.memberId}
        and batch_id = ${parsed.data.batchId}
      limit 1
    `);
    if ((enrolled as unknown as { rows: Array<{ id: string }> }).rows.length > 0) {
      return {
        kind: "error",
        code: "already_on_waitlist",
        message: "Member is already enrolled in this batch.",
      };
    }

    // Refuse if the member already has an open waitlist row.
    const existing = await tx
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.tenantId, ctx.tenantId),
          eq(waitlistEntries.memberId, asMemberId(parsed.data.memberId)),
          eq(waitlistEntries.batchId, parsed.data.batchId),
          eq(waitlistEntries.status, "waiting"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return {
        kind: "error",
        code: "already_on_waitlist",
        message: "Member is already on this batch's waitlist.",
      };
    }

    // Next position = max + 1 (or 1 if empty).
    const head = await tx
      .select({ maxPosition: sql<number>`coalesce(max(${waitlistEntries.position}), 0)::int` })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.tenantId, ctx.tenantId),
          eq(waitlistEntries.batchId, parsed.data.batchId),
          eq(waitlistEntries.status, "waiting"),
        ),
      );
    const nextPos = (head[0]?.maxPosition ?? 0) + 1;

    const [row] = await tx
      .insert(waitlistEntries)
      .values({
        tenantId: ctx.tenantId,
        memberId: asMemberId(parsed.data.memberId),
        batchId: parsed.data.batchId,
        status: "waiting",
        position: nextPos,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: waitlistEntries.id, position: waitlistEntries.position });
    return { kind: "ok", entryId: row!.id, position: nextPos };
  });
}

const removeSchema = z.object({
  memberId: z.string().uuid(),
  batchId: z.string().uuid(),
});

export async function cancelWaitlist(
  ctx: ActionCtx,
  raw: unknown,
): Promise<WaitlistResult> {
  const parsed = removeSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid waitlist cancel." };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const [entry] = await tx
      .update(waitlistEntries)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(waitlistEntries.tenantId, ctx.tenantId),
          eq(waitlistEntries.memberId, asMemberId(parsed.data.memberId)),
          eq(waitlistEntries.batchId, parsed.data.batchId),
          eq(waitlistEntries.status, "waiting"),
        ),
      )
      .returning({ id: waitlistEntries.id, position: waitlistEntries.position });
    if (!entry) {
      return { kind: "error", code: "not_on_waitlist", message: "Not on the waitlist." };
    }
    // Re-index the queue: every waiting entry that was
    // behind the cancelled row slides up by one. We compute
    // the cancelled position inline (no correlated subquery
    // that could conflict with the just-set status).
    await tx
      .update(waitlistEntries)
      .set({ position: sql`position - 1` })
      .where(
        and(
          eq(waitlistEntries.tenantId, ctx.tenantId),
          eq(waitlistEntries.batchId, parsed.data.batchId),
          eq(waitlistEntries.status, "waiting"),
          sql`${waitlistEntries.position} > ${entry.position}`,
        ),
      );
    return { kind: "ok", entryId: entry.id, position: 0 };
  });
}

const batchSchema = z.object({ batchId: z.string().uuid() });

export type WaitlistHead = {
  entryId: string;
  memberId: string;
  position: number;
};

export async function getWaitlistHead(
  ctx: ActionCtx,
  raw: unknown,
): Promise<WaitlistHead | null> {
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        entryId: waitlistEntries.id,
        memberId: waitlistEntries.memberId,
        position: waitlistEntries.position,
      })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.tenantId, ctx.tenantId),
          eq(waitlistEntries.batchId, parsed.data.batchId),
          eq(waitlistEntries.status, "waiting"),
        ),
      )
      .orderBy(asc(waitlistEntries.position))
      .limit(1);
    return row
      ? { entryId: row.entryId, memberId: row.memberId, position: row.position }
      : null;
  });
}

const promoteSchema = z.object({
  batchId: z.string().uuid(),
});

export async function promoteHead(
  ctx: ActionCtx,
  raw: unknown,
): Promise<WaitlistResult> {
  console.log("promote called");
  const parsed = promoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid promotion." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    // Inline the head query — withTenant cannot nest (db/scope.ts),
    // so getWaitlistHead's own withTenant would throw from here.
    const headRow = await tx
      .select({ entryId: waitlistEntries.id, memberId: waitlistEntries.memberId, position: waitlistEntries.position })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.tenantId, ctx.tenantId),
          eq(waitlistEntries.batchId, parsed.data.batchId),
          eq(waitlistEntries.status, "waiting"),
        ),
      )
      .orderBy(asc(waitlistEntries.position))
      .limit(1);
    const head = headRow[0]
      ? { entryId: headRow[0].entryId, memberId: headRow[0].memberId, position: headRow[0].position }
      : null;
    if (!head) {
      return { kind: "error", code: "not_on_waitlist", message: "Empty waitlist." };
    }
    await tx
      .update(waitlistEntries)
      .set({ status: "promoted", promotedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(waitlistEntries.id, head.entryId));
    await tx
      .update(waitlistEntries)
      .set({ position: sql`position - 1` })
      .where(
        and(
          eq(waitlistEntries.tenantId, ctx.tenantId),
          eq(waitlistEntries.batchId, parsed.data.batchId),
          eq(waitlistEntries.status, "waiting"),
          sql`${waitlistEntries.position} > ${head.position}`,
        ),
      );
    return { kind: "ok", entryId: head.entryId, position: head.position };
  });
}

void eq;
void sql;
