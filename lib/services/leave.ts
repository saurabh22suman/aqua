import { and, asc, between, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import { type StaffId, type TenantId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-26 — leave types, requests and balances (architecture.md §8.9).
//
// The leave year is the calendar year (stated assumption): balances
// count requests whose from_date falls in the year. `available` is
// quota minus approved minus pending, so two pending requests cannot
// both pass the check and leave the quota overdrawn. Unpaid leave is
// distinguished by leave_types.is_paid (V-30 deducts it later).
//
// Seeding: the migration backfills casual/sick/unpaid for existing
// tenants; seedDefaultLeaveTypes() does the same for new tenants
// inside the provisioning transaction (db/platform-tenant-create.ts)
// and for the dev/demo seeders.

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

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

export const leaveTypeUpdateInput = leaveTypeInput.extend({ id: uuid });

export const leaveRequestInput = z.object({
  leaveTypeId: uuid,
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().trim().max(500).nullish(),
});

export const leaveYearInput = z.object({ year: z.number().int().min(2000).max(2100) });

export const leaveListInput = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
});

export type LeaveTypeRow = {
  id: string;
  name: string;
  annualQuota: number | null;
  isPaid: boolean;
};

export type LeaveBalanceRow = {
  leaveTypeId: string;
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  usedDays: number;
  pendingDays: number;
  availableDays: number | null;
};

export type LeaveRequestRow = {
  id: string;
  staffId: string;
  staffName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
};

type Fail = { ok: false; error: string };
export type LeaveTypeResult = { ok: true; leaveTypeId: string } | Fail;
export type LeaveRequestResult = { ok: true; requestId: string; days: number } | Fail;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid leave input.";
}

function daysInclusive(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(diff / 86_400_000) + 1;
}

function yearBounds(year: number): { fromDate: string; toDate: string } {
  return { fromDate: `${year}-01-01`, toDate: `${year}-12-31` };
}

async function seedDefaultsOnTx(tx: TenantTx, tenantId: TenantId): Promise<void> {
  for (const preset of DEFAULT_LEAVE_TYPES) {
    await tx
      .insert(leaveTypes)
      .values({
        tenantId,
        name: preset.name,
        annualQuota: preset.annualQuota,
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

async function ownStaffIdInTx(
  tx: TenantTx,
  ctx: ActionCtx,
): Promise<StaffId | null> {
  if (!ctx.userId) return null;
  const [row] = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.tenantId, ctx.tenantId),
        eq(staff.userId, ctx.userId),
        isNull(staff.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function listLeaveTypes(ctx: ActionCtx): Promise<LeaveTypeRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        annualQuota: leaveTypes.annualQuota,
        isPaid: leaveTypes.isPaid,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.tenantId, ctx.tenantId))
      .orderBy(asc(leaveTypes.name));
    return rows;
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

async function balancesInTx(
  tx: TenantTx,
  tenantId: TenantId,
  staffId: StaffId,
  year: number,
): Promise<LeaveBalanceRow[]> {
  const types = await tx
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.tenantId, tenantId))
    .orderBy(asc(leaveTypes.name));

  const bounds = yearBounds(year);
  const requests = await tx
    .select({
      leaveTypeId: leaveRequests.leaveTypeId,
      days: leaveRequests.days,
      status: leaveRequests.status,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, tenantId),
        eq(leaveRequests.staffId, staffId),
        between(leaveRequests.fromDate, bounds.fromDate, bounds.toDate),
      ),
    );

  const used = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const request of requests) {
    const days = Number(request.days);
    if (request.status === "approved") {
      used.set(request.leaveTypeId, (used.get(request.leaveTypeId) ?? 0) + days);
    } else if (request.status === "pending") {
      pending.set(
        request.leaveTypeId,
        (pending.get(request.leaveTypeId) ?? 0) + days,
      );
    }
  }

  return types.map((type) => {
    const usedDays = used.get(type.id) ?? 0;
    const pendingDays = pending.get(type.id) ?? 0;
    return {
      leaveTypeId: type.id,
      name: type.name,
      isPaid: type.isPaid,
      annualQuota: type.annualQuota,
      usedDays,
      pendingDays,
      availableDays:
        type.annualQuota === null
          ? null
          : Math.max(0, type.annualQuota - usedDays - pendingDays),
    };
  });
}

export async function requestLeave(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveRequestResult> {
  const parsed = leaveRequestInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (input.toDate < input.fromDate) {
    return { ok: false, error: "The end date must be on or after the start date." };
  }
  const days = daysInclusive(input.fromDate, input.toDate);
  const year = Number(input.fromDate.slice(0, 4));

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }

    const [type] = await tx
      .select()
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.id, input.leaveTypeId),
          eq(leaveTypes.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!type) return { ok: false, error: "Leave type not found." };

    if (type.annualQuota !== null) {
      const balances = await balancesInTx(tx, ctx.tenantId, staffId, year);
      const balance = balances.find((b) => b.leaveTypeId === type.id);
      const available = balance?.availableDays ?? type.annualQuota;
      if (days > available) {
        return {
          ok: false,
          error: `Only ${available} day${available === 1 ? "" : "s"} of ${type.name} leave left this year.`,
        };
      }
    }

    const [inserted] = await tx
      .insert(leaveRequests)
      .values({
        tenantId: ctx.tenantId,
        staffId,
        leaveTypeId: type.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        days: String(days),
        reason: input.reason ?? null,
        status: "pending",
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: leaveRequests.id });
    if (!inserted) return { ok: false, error: "The request could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave.request",
      entityType: "leave_request",
      entityId: inserted.id,
      after: {
        staffId,
        leaveTypeId: type.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        days,
        status: "pending",
      },
    });

    return { ok: true, requestId: inserted.id, days };
  });
}

export async function cancelLeaveRequest(
  ctx: ActionCtx,
  requestId: string,
): Promise<{ ok: true } | Fail> {
  const parsed = uuid.safeParse(requestId);
  if (!parsed.success) return { ok: false, error: "Invalid leave request." };

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }

    const [request] = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, parsed.data),
          eq(leaveRequests.tenantId, ctx.tenantId),
          eq(leaveRequests.staffId, staffId),
        ),
      )
      .for("update");
    if (!request) return { ok: false, error: "Leave request not found." };
    if (request.status !== "pending") {
      return { ok: false, error: "Only a pending request can be cancelled." };
    }

    await tx
      .update(leaveRequests)
      .set({ status: "cancelled", updatedBy: ctx.userId, updatedAt: new Date() })
      .where(
        and(
          eq(leaveRequests.id, request.id),
          eq(leaveRequests.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave.cancel",
      entityType: "leave_request",
      entityId: request.id,
      before: { status: request.status },
      after: { status: "cancelled" },
    });

    return { ok: true };
  });
}

export async function listMyLeave(
  ctx: ActionCtx,
  raw: unknown,
): Promise<{ balances: LeaveBalanceRow[]; requests: LeaveRequestRow[] }> {
  const parsed = leaveYearInput.safeParse(raw);
  if (!parsed.success) return { balances: [], requests: [] };
  const { year } = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) return { balances: [], requests: [] };

    const balances = await balancesInTx(tx, ctx.tenantId, staffId, year);
    const bounds = yearBounds(year);
    const rows = await tx
      .select({
        id: leaveRequests.id,
        staffId: leaveRequests.staffId,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        days: leaveRequests.days,
        reason: leaveRequests.reason,
        status: leaveRequests.status,
        decidedAt: leaveRequests.decidedAt,
        decisionNote: leaveRequests.decisionNote,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.tenantId, ctx.tenantId),
          eq(leaveRequests.staffId, staffId),
          between(leaveRequests.fromDate, bounds.fromDate, bounds.toDate),
        ),
      )
      .orderBy(desc(leaveRequests.fromDate));

    return {
      balances,
      requests: rows.map((r) => ({
        ...r,
        staffName: "",
        days: Number(r.days),
        decidedAt: r.decidedAt?.toISOString() ?? null,
      })),
    };
  });
}

export async function listLeaveRequests(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveRequestRow[]> {
  const parsed = leaveListInput.safeParse(raw ?? {});
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(leaveRequests.tenantId, ctx.tenantId)];
    if (input.status) conditions.push(eq(leaveRequests.status, input.status));

    const rows = await tx
      .select({
        id: leaveRequests.id,
        staffId: leaveRequests.staffId,
        staffName: persons.fullName,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        days: leaveRequests.days,
        reason: leaveRequests.reason,
        status: leaveRequests.status,
        decidedAt: leaveRequests.decidedAt,
        decisionNote: leaveRequests.decisionNote,
      })
      .from(leaveRequests)
      .innerJoin(staff, eq(staff.id, leaveRequests.staffId))
      .innerJoin(persons, eq(persons.id, staff.personId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(...conditions))
      .orderBy(asc(leaveRequests.fromDate))
      .limit(100);

    return rows.map((r) => ({
      ...r,
      days: Number(r.days),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
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
