"use server";

import { z } from "zod";
import { reportPeriodSchema } from "@/lib/services/owner-reports";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getAttendanceReport,
  getEnquiryFunnel,
  getRetentionReport,
  getCoachLoad,
  attendanceReportCsv,
  type BatchAttendanceReportRow,
  type CoachLoadRow,
  type EnquiryFunnelRow,
  type RetentionReport,
} from "@/lib/services/owner-reports";
import {
  getFacilityUtilisation,
  utilisationInput,
  type UtilisationReport,
} from "@/lib/services/utilisation";

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
const periodWithFacilitySchema = reportPeriodSchema.extend({
  locationId: z.string().uuid().optional(),
});

export async function getAttendanceReportAction(raw: unknown): Promise<BatchAttendanceReportRow[]> {
  const parsed = periodWithFacilitySchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  // The FULL authenticated context, not a narrowed `{ tenantId }`
  // literal: requireDefaultCtx() has already resolved the caller's
  // identity, role, permission set and LOCATION SCOPE. Rebuilding a
  // narrow context here drops the location scope before the service
  // can apply it, and the O-08 gate in the service cannot see what
  // this adapter threw away — a location-restricted caller would be
  // served the wrong rows instead of an error. Same contract as the
  // owner-insights action (lib/actions/owner-insights.ts).
  return getAttendanceReport(ctx, parsed, {
    locationId: parsed.locationId,
  });
}

export async function getEnquiryFunnelAction(raw: unknown): Promise<EnquiryFunnelRow[]> {
  const period = periodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getEnquiryFunnel({ tenantId: ctx.tenantId }, period);
}

export async function getRetentionViewAction(): Promise<RetentionReport> {
  // No input — the period is "the last 30 days from today",
  // computed inside the service.
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getRetentionReport({ tenantId: ctx.tenantId });
}

export async function getCoachLoadAction(raw: unknown): Promise<CoachLoadRow[]> {
  const period = periodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getCoachLoad({ tenantId: ctx.tenantId }, period);
}

// V-08 — facility utilisation card. A read of the last 4 weeks of
// bookings against configured business hours; an optional locationId
// narrows it to one facility (the owner facility switcher), otherwise
// every facility is reported.
export async function getFacilityUtilisationAction(raw?: unknown): Promise<UtilisationReport> {
  const parsed = utilisationInput.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getFacilityUtilisation({ tenantId: ctx.tenantId }, parsed);
}

export async function attendanceReportCsvAction(raw: unknown): Promise<CsvEnvelope> {
  // P1 (2026-10-13 owner-UI review) — the export carries the same
  // facility scope the on-screen report displays; the service applies
  // the caller's location predicate on top, so a restricted caller
  // cannot export records outside their access.
  //
  // The same full context as the screen read (see
  // getAttendanceReportAction): the export must show the caller
  // exactly the rows the screen shows them, or the CSV becomes a
  // wider or narrower view of the same report than the one on screen.
  const parsed = periodWithFacilitySchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  const rows = await getAttendanceReport(ctx, parsed, {
    locationId: parsed.locationId,
  });
  return {
    filename: `attendance-${parsed.from}-to-${parsed.to}${
      parsed.locationId ? `-${parsed.locationId}` : ""
    }.csv`,
    body: attendanceReportCsv(rows),
  };
}