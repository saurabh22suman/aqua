// POST-IMAGE — NOT APPLIED, NOT COMPILED, NOT TYPECHECKED, NOT LINTED, NOT
// TESTED, NOT RUN.
//
// Proposed target:
//   lib/services/leave-types.ts
//
// The only changes are the two marked blocks and the one import. Everything
// else in the file is byte-identical to the file in the tree.
//
// ── HOW THIS FILE DIFFERS FROM THE REPAIRED POST-IMAGE ──────────────────────
//
// The CODE is unchanged. The independent review found no security
// regression in it, and this packet carries it unchanged. The COMMENTS are
// reconciled with the review's findings (each traced in
// docs/design/parallel-release/manager-owner-types-existing-identity-final-review-20261108/
// RECONCILIATION.md §2.2):
//
//   • this packet's directory in the gate comment (the repaired packet's
//     path would have pointed at a superseded directory);
//   • the lock-order sentence → the BOUNDED LOCK SET (H2). The repaired
//     packet wrote "The only product writers that take a membership row
//     lock are …" and named TWO of them. That was FALSE: there are FIVE
//     product writers of `tenant_memberships`. The bound survives and
//     WIDENS, but the enumeration is replaced by the class — every writer
//     of that table that changes `status`, `role_id` or `links_valid_from`
//     takes FOR NO KEY UPDATE, which conflicts with FOR SHARE — with the
//     five writers named as evidence;
//   • the liveness mechanism sentence (M1): under READ COMMITTED the
//     blocked `SELECT … FOR SHARE` re-evaluates its WHERE clause on the
//     new row version and SKIPS the row, so the gate receives ZERO ROWS —
//     it never observes `status = 'revoked'`.
//

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { leaveTypes } from "@/db/schema/leave";
import { writeAudit } from "@/lib/audit/write";
import type { TenantId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";
import {
  OWNER_WRITE_REFUSAL,
  callerIsLiveOwnerInTx,
} from "@/lib/services/leave-owner-identity";

// V-26 — leave types and their seeding. The migration backfilled the
// defaults for existing tenants; seedDefaultLeaveTypes() does the same
// for new tenants inside the provisioning transaction and for the
// dev/demo seeders.

export const DEFAULT_LEAVE_TYPES = [
  { name: "Casual", annualQuota: 12, isPaid: true },
  { name: "Sick", annualQuota: 8, isPaid: true },
  { name: "Unpaid", annualQuota: null, isPaid: false },
] as const;

export const leaveTypeInput = z.object({
  name: z.string().trim().min(1).max(60),
  annualQuota: z.number().int().min(0).max(366).nullish(),
  isPaid: z.boolean(),
});

export const leaveTypeUpdateInput = leaveTypeInput.extend({
  id: z.string().uuid(),
});

export type LeaveTypeRow = {
  id: string;
  name: string;
  annualQuota: number | null;
  isPaid: boolean;
};

export type LeaveTypeResult =
  | { ok: true; leaveTypeId: string }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid leave input.";
}

async function seedDefaultsOnTx(tx: TenantTx, tenantId: TenantId): Promise<void> {
  for (const preset of DEFAULT_LEAVE_TYPES) {
    await tx
      .insert(leaveTypes)
      .values({
        tenantId,
        name: preset.name,
        annualQuota: preset.annualQuota ?? null,
        isPaid: preset.isPaid,
      })
      .onConflictDoNothing({ target: [leaveTypes.tenantId, leaveTypes.name] });
  }
}

export async function seedDefaultLeaveTypes(
  tenantId: TenantId,
  tx?: TenantTx,
): Promise<void> {
  if (tx) return seedDefaultsOnTx(tx, tenantId);
  return withTenant(tenantId, (innerTx) => seedDefaultsOnTx(innerTx, tenantId));
}

// The READ half is deliberately NOT gated. A coach must be able to pick a
// leave type to request leave, so the catalogue read stays open to every
// staff member. The rule is a WRITE rule.
export async function listLeaveTypes(ctx: ActionCtx): Promise<LeaveTypeRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    return tx
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        annualQuota: leaveTypes.annualQuota,
        isPaid: leaveTypes.isPaid,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.tenantId, ctx.tenantId))
      .orderBy(asc(leaveTypes.name));
  });
}

export async function createLeaveType(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    // ── THE CLUB-WIDE WRITE IS OWNER-ONLY ────────────────────────────
    //
    // `leave_types` carries no location column (db/schema/leave.ts:29-51):
    // the catalogue is a CLUB-WIDE object, so under the standing rule —
    // "club-wide settings and access delegation remain owner-only" — its
    // writes belong to the owner.
    //
    // The gate reads the caller's OWN live membership and the LIVE role
    // row that membership names. It does NOT read ctx.roleKey, ctx.roleId,
    // ctx.membershipId or ctx.permissions: a caller that claims to be the
    // owner while its membership is somebody else's is refused.
    //
    // The refusal is UNIFORM ("Not authorized.") for every reason — no
    // membership, another club's membership, a revoked membership, a
    // soft-deleted membership, a soft-deleted role, a role that is not the
    // owner, and an identity-free caller — so a non-owner learns nothing
    // about which conjunct refused it.
    //
    // It happens BEFORE the write and before the audit row, so a refused
    // caller leaves NO row and NO audit row: the refusal returns from
    // inside the transaction with nothing written.
    //
    // THE LOCK SET IS BOUNDED, not asserted: the gate locks AT MOST ONE
    // membership row (`tenant_memberships` is UNIQUE (tenant_id, user_id) —
    // db/schema/memberships.ts:46) and AT MOST ONE role row (`roles` is
    // UNIQUE (tenant_id, key) — db/schema/roles.ts:40). EVERY product
    // writer that UPDATEs `tenant_memberships` changes only `status`,
    // `role_id`, `links_valid_from`, `updated_at` or `updated_by` — none
    // of which is in a unique index on that table — so each takes FOR NO
    // KEY UPDATE, which CONFLICTS WITH the gate's FOR SHARE. The five
    // writers that exist today (staff-invitations.ts:553-561 and :819-832,
    // invite-link.ts:271-280, db/membership-activation.ts:55-65,
    // curriculum-lead.ts:209-217) are evidence for that class, not an
    // exhaustive list. NONE of them takes a role lock; and no writer holds
    // a `leave_types` lock and then asks for a membership lock. So the
    // order membership (M) → role (R) → leave_types (T) has no inversion.
    //
    // LIVENESS: if a revocation COMMITTED while this gate was waiting, the
    // blocked `SELECT … FOR SHARE` re-evaluates its WHERE clause on the
    // new row version (EvalPlanQual) and SKIPS the row — `status =
    // 'active'` no longer matches — so the gate receives ZERO ROWS. It
    // never observes `status = 'revoked'`; it simply finds no live owner
    // row and refuses.
    //
    // The predicate, its F-04 / F-03a exception and its residuals are
    // documented in
    // docs/design/parallel-release/manager-owner-types-existing-identity-final-review-20261108/.
    if (!(await callerIsLiveOwnerInTx(tx, ctx))) {
      return { ok: false, error: OWNER_WRITE_REFUSAL };
    }

    let inserted: { id: string } | undefined;
    try {
      [inserted] = await tx
        .insert(leaveTypes)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          annualQuota: input.annualQuota ?? null,
          isPaid: input.isPaid,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: leaveTypes.id });
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        return { ok: false, error: "A leave type with that name already exists." };
      }
      throw error;
    }
    if (!inserted) return { ok: false, error: "The leave type could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave_type.create",
      entityType: "leave_type",
      entityId: inserted.id,
      after: {
        name: input.name,
        annualQuota: input.annualQuota ?? null,
        isPaid: input.isPaid,
      },
    });
    return { ok: true, leaveTypeId: inserted.id };
  });
}

export async function updateLeaveType(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeUpdateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    // ── THE CLUB-WIDE WRITE IS OWNER-ONLY ────────────────────────────
    //
    // The same gate as `createLeaveType`, and it runs BEFORE the
    // `leave_types` row is locked, so a refused caller takes no row lock
    // at all. The lock order stays membership (M) → role (R) → leave_types
    // (T): the gate's FOR SHARE on the membership and the role is taken
    // first, then the catalogue row.
    //
    // THE ORDERING CLAIM IS A SPECIFICATION DEPENDENCY, not an accident:
    // the concurrency case (N4b) parks the writer on the catalogue row
    // lock and observes the concurrent revocation blocked on the gate's
    // membership lock. If a future implementation moved the gate AFTER
    // the catalogue-row lock, the writer would hold no membership lock
    // while parked and the revocation would NOT be blocked — the case
    // would then fail for a reason that is a specification change, not a
    // bug. Keep the gate BEFORE the row lock.
    if (!(await callerIsLiveOwnerInTx(tx, ctx))) {
      return { ok: false, error: OWNER_WRITE_REFUSAL };
    }

    const [existing] = await tx
      .select()
      .from(leaveTypes)
      .where(
        and(eq(leaveTypes.id, input.id), eq(leaveTypes.tenantId, ctx.tenantId)),
      )
      .for("update");
    if (!existing) return { ok: false, error: "Leave type not found." };

    await tx
      .update(leaveTypes)
      .set({
        name: input.name,
        annualQuota: input.annualQuota ?? null,
        isPaid: input.isPaid,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(leaveTypes.id, input.id), eq(leaveTypes.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave_type.update",
      entityType: "leave_type",
      entityId: input.id,
      before: {
        name: existing.name,
        annualQuota: existing.annualQuota,
        isPaid: existing.isPaid,
      },
      after: {
        name: input.name,
        annualQuota: input.annualQuota ?? null,
        isPaid: input.isPaid,
      },
    });
    return { ok: true, leaveTypeId: input.id };
  });
}

function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
