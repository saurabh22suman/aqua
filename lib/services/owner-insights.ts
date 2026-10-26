// Owner insights — the two selected additional charts
// (chart-gallery02 "Attendance by batch" and chart-gallery05
// "Enquiries by current stage") as service read models.
//
// This module is the stable import path. The two read models live in
// their own modules, and BOTH of them are gated: each parses its
// input, refuses a caller that may not read operational reports, and
// only then reads. Importing the underlying module directly does not
// reach an unguarded read.
//
// The module exposes no Server Action: wiring one needs the shared
// action-permission map, which this lane does not own. The action
// must parse with `ownerInsightInputSchema`, call
// `requirePermission(ctx, OWNER_INSIGHT_PERMISSION_KEY)`, and pass the
// FULL ctx (user, role and permission set) to the service — the
// service gate reads the caller's resolved permissions.
//
// The numbers are aggregates. There is no per-child row anywhere in
// these DTOs — a batch, a stage, a count and a share. Nothing here
// can become a child's risk profile.

export { getAttendanceByBatch } from "@/lib/services/owner-insights-attendance";
export { getEnquiryStageBreakdown } from "@/lib/services/owner-insights-enquiries";
export {
  OWNER_INSIGHT_FEATURE_KEY,
  OWNER_INSIGHT_PERMISSION_KEY,
} from "@/lib/services/owner-insights-access";
export { ownerInsightInputSchema } from "@/lib/services/owner-insights-period";

export type {
  AttendanceByBatchInsight,
  AttendanceByBatchRow,
  AttendanceMarkCounts,
  AttendanceMarkShares,
  RegisterCompletion,
} from "@/lib/services/owner-insights-attendance";
export type {
  EnquiryStageInsight,
  EnquiryStageInsightRow,
} from "@/lib/services/owner-insights-enquiries";
export type { OwnerInsightInput } from "@/lib/services/owner-insights-period";
