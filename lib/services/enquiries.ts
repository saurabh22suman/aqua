// The enquiry service — public façade.
//
// The implementation lives in flat, cohesive modules beside this file:
//
//   ./enquiry-scope       the visibility rule (tenant, soft delete,
//                         location scope, the management-only
//                         unresolved queue) and the shared row shape
//   ./enquiry-capture     C-12 — capturing a walk-in
//   ./enquiry-reads       the list, the detail, the overdue
//                         follow-ups and the current-stage aggregate
//   ./enquiry-pipeline    C-13 — stage transitions and follow-ups
//   ./enquiry-conversion  C-14/C-15 — booking a trial, converting,
//                         and the conversion rate by source
//
// This file re-exports the whole public surface so every existing
// import path (`@/lib/services/enquiries`) keeps working unchanged.
// The split is a MOVE, not a rewrite: the behaviour, the scoping, the
// transactions and the permissions are exactly what they were — the
// characterisation suite (tests/enquiry-service-characterization.test.ts)
// pins that, and the protected tier1 suite (tests/tier1/enquiries.test.ts)
// covers the deep paths.

export { createEnquiry } from "@/lib/services/enquiry-capture";

export {
  listEnquiries,
  getEnquiryDetail,
  listOverdueFollowUps,
  countEnquiriesByCurrentStage,
  type EnquiryDetail,
  type OverdueFollowUp,
  type EnquiryStageCount,
  type EnquiryStageCounts,
} from "@/lib/services/enquiry-reads";

export {
  transitionEnquiryStage,
  addFollowUp,
  completeFollowUp,
  type StageResult,
} from "@/lib/services/enquiry-pipeline";

export {
  bookTrial,
  convertEnquiry,
  conversionRateBySource,
  type NewMemberDetails,
  type SourceConversion,
} from "@/lib/services/enquiry-conversion";

export { type EnquiryRow } from "@/lib/services/enquiry-scope";
