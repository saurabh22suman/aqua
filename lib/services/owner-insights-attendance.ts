import { withTenant, type TenantTx } from "@/db/tenant";
import {
  readAttendanceRows,
  type AttendanceByBatchParams,
  type SessionMarkRow,
  type SessionRosterRow,
} from "@/lib/services/owner-insights-attendance-sql";
import { ownerInsightInputSchema } from "@/lib/services/owner-insights-period";
import { assertInsightAccess } from "@/lib/services/owner-insights-access";
import type { ActionCtx } from "@/lib/auth/context";

// chart-gallery02 — "Attendance by batch".
//
// TWO separate measurements, never one:
//
//   1. The composition of the marks that were RECORDED: present /
//      late / absent, as shares of the marks. A roster member with no
//      mark is NOT absent — the mark was never written, so the honest
//      reading is "unknown", and it belongs to the register measure,
//      not to the absent count.
//
//   2. The register completion, measured against the EFFECTIVE
//      HISTORICAL ROSTER of each session: the members who were
//      enrolled in that batch on or before that session's date (the
//      same rule the coach's register uses, lib/services/register.ts).
//      A session's register is complete when every member on that
//      roster carries a mark.
//
// A batch with sessions but no marks is reported with null shares —
// "no marks yet", never 0%.
//
// Both measurements are aggregates over a batch. No member identity
// leaves this module: scope § 7.1 forbids per-child risk profiles,
// and a chart that could produce one would be one query away from it.

export type AttendanceMarkCounts = {
  present: number;
  late: number;
  absent: number;
  /** Marks recorded: present + late + absent. */
  total: number;
};

export type AttendanceMarkShares = {
  /** Share of the recorded marks. null when nothing was marked. */
  present: number | null;
  late: number | null;
  absent: number | null;
};

export type RegisterCompletion = {
  /** Sessions in the window whose effective roster had at least one member. */
  sessionsWithRoster: number;
  /** Sessions where every member on the effective roster carries a mark. */
  completedRegisters: number;
  /** completedRegisters ÷ sessionsWithRoster. null when nothing had a roster. */
  completionPct: number | null;
  /** Effective historical roster slots across the window. */
  rosterSlots: number;
  /** Roster members that carry a mark. */
  markedSlots: number;
  /** Roster members with no mark — unknown, never counted as absent. */
  unmarkedSlots: number;
};

export type AttendanceByBatchRow = {
  batchId: string;
  batchName: string;
  programName: string;
  locationId: string | null;
  /** Non-cancelled sessions of this batch inside the window. */
  sessions: number;
  marks: AttendanceMarkCounts;
  shares: AttendanceMarkShares;
  register: RegisterCompletion;
};

export type AttendanceByBatchInsight = {
  /** Inclusive window start (tenant timezone). */
  from: string;
  /** Exclusive window end (tenant timezone). */
  to: string;
  rows: AttendanceByBatchRow[];
  summary: {
    sessions: number;
    marks: AttendanceMarkCounts;
    shares: AttendanceMarkShares;
    register: RegisterCompletion;
  };
};

export type { AttendanceByBatchParams };

function sharesOf(marks: AttendanceMarkCounts): AttendanceMarkShares {
  if (marks.total === 0) return { present: null, late: null, absent: null };
  return {
    present: Math.round((marks.present / marks.total) * 100),
    late: Math.round((marks.late / marks.total) * 100),
    absent: Math.round((marks.absent / marks.total) * 100),
  };
}

function registerOf(
  sessionsWithRoster: number,
  completedRegisters: number,
  rosterSlots: number,
  markedSlots: number,
): RegisterCompletion {
  return {
    sessionsWithRoster,
    completedRegisters,
    completionPct:
      sessionsWithRoster > 0
        ? Math.round((completedRegisters / sessionsWithRoster) * 100)
        : null,
    rosterSlots,
    markedSlots,
    unmarkedSlots: Math.max(0, rosterSlots - markedSlots),
  };
}

type BatchMarks = {
  batchName: string;
  programName: string;
  locationId: string | null;
  sessions: number;
  marks: AttendanceMarkCounts;
};

type BatchRoster = {
  sessionsWithRoster: number;
  completedRegisters: number;
  rosterSlots: number;
  markedSlots: number;
};

function markTotals(rows: SessionMarkRow[]): Map<string, BatchMarks> {
  const totals = new Map<string, BatchMarks>();
  for (const row of rows) {
    const batch = totals.get(row.batchId) ?? {
      batchName: row.batchName,
      programName: row.programName ?? "",
      locationId: row.locationId,
      sessions: 0,
      marks: { present: 0, late: 0, absent: 0, total: 0 },
    };
    batch.sessions += 1;
    batch.marks.present += Number(row.present);
    batch.marks.late += Number(row.late);
    batch.marks.absent += Number(row.absent);
    batch.marks.total += Number(row.marked);
    totals.set(row.batchId, batch);
  }
  return totals;
}

function rosterTotals(rows: SessionRosterRow[]): Map<string, BatchRoster> {
  const totals = new Map<string, BatchRoster>();
  for (const row of rows) {
    const rosterSlots = Number(row.rosterSlots);
    const markedSlots = Number(row.markedSlots);
    const batch = totals.get(row.batchId) ?? {
      sessionsWithRoster: 0,
      completedRegisters: 0,
      rosterSlots: 0,
      markedSlots: 0,
    };
    batch.sessionsWithRoster += 1;
    batch.rosterSlots += rosterSlots;
    batch.markedSlots += markedSlots;
    // A register is complete when every member on the effective
    // roster carries a mark — an "absent" mark counts, a missing
    // mark does not.
    if (rosterSlots > 0 && markedSlots >= rosterSlots) {
      batch.completedRegisters += 1;
    }
    totals.set(row.batchId, batch);
  }
  return totals;
}

async function buildAttendanceInsight(
  tx: TenantTx,
  ctx: ActionCtx,
  params: AttendanceByBatchParams,
): Promise<AttendanceByBatchInsight> {
  const { marks: markRows, rosters: rosterRows } = await readAttendanceRows(tx, ctx, params);
  const marks = markTotals(markRows);
  const rosters = rosterTotals(rosterRows);

  const rows: AttendanceByBatchRow[] = [...marks.entries()]
    .map(([batchId, batch]) => {
      const roster = rosters.get(batchId) ?? {
        sessionsWithRoster: 0,
        completedRegisters: 0,
        rosterSlots: 0,
        markedSlots: 0,
      };
      return {
        batchId,
        batchName: batch.batchName,
        programName: batch.programName,
        locationId: batch.locationId,
        sessions: batch.sessions,
        marks: batch.marks,
        shares: sharesOf(batch.marks),
        register: registerOf(
          roster.sessionsWithRoster,
          roster.completedRegisters,
          roster.rosterSlots,
          roster.markedSlots,
        ),
      };
    })
    .sort((a, b) => a.batchName.localeCompare(b.batchName));

  const summaryMarks = rows.reduce<AttendanceMarkCounts>(
    (sum, row) => ({
      present: sum.present + row.marks.present,
      late: sum.late + row.marks.late,
      absent: sum.absent + row.marks.absent,
      total: sum.total + row.marks.total,
    }),
    { present: 0, late: 0, absent: 0, total: 0 },
  );
  const summaryRegister = registerOf(
    rows.reduce((sum, row) => sum + row.register.sessionsWithRoster, 0),
    rows.reduce((sum, row) => sum + row.register.completedRegisters, 0),
    rows.reduce((sum, row) => sum + row.register.rosterSlots, 0),
    rows.reduce((sum, row) => sum + row.register.markedSlots, 0),
  );

  return {
    from: params.from,
    to: params.to,
    rows,
    summary: {
      sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
      marks: summaryMarks,
      shares: sharesOf(summaryMarks),
      register: summaryRegister,
    },
  };
}

// The ONLY way into this read model. It parses its input, refuses a
// caller that may not read operational reports, and only then opens
// the data transaction — the grant is resolved inside that same
// transaction (in the data-access module), so a read is never taken
// before the gate passes.
export async function getAttendanceByBatch(
  ctx: ActionCtx,
  raw: unknown,
): Promise<AttendanceByBatchInsight> {
  const input = ownerInsightInputSchema.parse(raw);
  await assertInsightAccess(ctx);
  return withTenant(ctx.tenantId, (tx) => buildAttendanceInsight(tx, ctx, input));
}
