"use server";

import { reportPeriodSchema } from "@/lib/services/owner-reports";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import {
  getAttendanceReport,
  getEnquiryFunnel,
  getRetentionView,
  getCoachLoad,
  attendanceReportCsv,
  type BatchAttendanceReportRow,
  type CoachLoadRow,
  type EnquiryFunnelRow,
  type RetentionRow,
} from "@/lib/services/owner-reports";

type CsvEnvelope = {
  filename: string;
  body: string;
};

// Phase 4 — owner reports. parse-then-permission preamble on
// every action: a period shape is the only input. Reads are
// staff-readable (assertStaff); writes would be management-
// only, but the four reports don't mutate. The CSV export
// reuses the same period so a curl to the route stays canonical.

const periodSchema = reportPeriodSchema;

export async function getAttendanceReportAction(raw: unknown): Promise<BatchAttendanceReportRow[]> {
  const period = periodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getAttendanceReport({ tenantId: ctx.tenantId }, period);
}

export async function getEnquiryFunnelAction(raw: unknown): Promise<EnquiryFunnelRow[]> {
  const period = periodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getEnquiryFunnel({ tenantId: ctx.tenantId }, period);
}

export async function getRetentionViewAction(): Promise<RetentionRow> {
  // No input — the period is "the last 30 days from today",
  // computed inside the service.
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getRetentionView({ tenantId: ctx.tenantId });
}

export async function getCoachLoadAction(raw: unknown): Promise<CoachLoadRow[]> {
  const period = periodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getCoachLoad({ tenantId: ctx.tenantId }, period);
}

export async function attendanceReportCsvAction(raw: unknown): Promise<CsvEnvelope> {
  const period = periodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  const rows = await getAttendanceReport({ tenantId: ctx.tenantId }, period);
  return {
    filename: `attendance-${period.from}-to-${period.to}.csv`,
    body: attendanceReportCsv(rows),
  };
}