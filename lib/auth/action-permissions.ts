// Action → permission key mapping for sub-PR 2 of role gating.
//
// Each tenant-path Server Action gets exactly one permission key
// it must `requirePermission(ctx, "x.y")` against. This is the
// single-resolution replacement for the role-key guards
// (assertStaff, assertManagement, assertMembersWrite,
// assertEnquiriesAccess) being deleted in this PR.
//
// Derivation rules (sub-PR 3's matrix test pins the truth table):
//   1. The action's effect on the world picks the verb: .read for
//      list/get/detail, .write for create/update/transition, and a
//      permission-specific verb for narrow operations.
//   2. The noun comes from the resource: members, attendance,
//      enquiries, etc. — already the PERMISSIONS catalogue.
//   3. Some actions span resources (e.g. markAttendanceSessionAction
//      writes attendance but reads members). The matrix test
//      accepts EITHER "attendance.mark" OR "members.read" as long
//      as the role carries one — but in this codebase the seeded
//      permission sets overlap, so we pick the more specific one.
//
// The matrix test in sub-PR 3 is the mechanical replacement; this
// file is the typed contract that defines what each action asks for.

export type PermissionActionMap = Readonly<Record<string, string>>;

export const ACTION_PERMISSION_MAP: PermissionActionMap = {
  // Members
  listMembersAction: "members.read",
  getMemberDetailAction: "members.read",
  searchPersonsAction: "members.read",
  getMemberIdCardContextAction: "members.read",
  listLocationsAction: "members.read",
  createMemberAction: "members.write",
  updateMemberAction: "members.write",
  transitionMemberStatusAction: "members.write",
  // Wave 2 — member facility opt-ins.
  listOptedFacilitiesAction: "members.read",
  addMemberFacilityAction: "members.write",
  endMemberFacilityAction: "members.write",

  // Attendance
  getMemberAttendanceHistoryAction: "attendance.read",
  getBatchAttendanceSummaryAction: "attendance.read",
  markAttendanceSessionAction: "attendance.mark",
  getRosterAction: "attendance.read",
  getTodayAction: "attendance.read",
  getCoachHomeAction: "attendance.read",
  getScheduleAction: "attendance.read",
  getCoachRosterAction: "attendance.read",
  getCoachMemberDetailAction: "members.read.assigned",

  // Programs and batches
  listProgramsAction: "programs.read",
  listBatchesAction: "programs.read",
  listCoachesAction: "staff.read",
  createProgramAction: "programs.write",
  updateProgramAction: "programs.write",
  deleteProgramAction: "programs.write",
  createBatchAction: "programs.write",
  updateBatchAction: "programs.write",
  deleteBatchAction: "programs.write",

  // Enrolments
  enrolMemberAction: "members.write",
  listMemberEnrolmentsAction: "members.read",
  transferMemberToBatchAction: "members.write",

  // Enquiries
  listEnquiriesAction: "enquiries.read",
  getEnquiryDetailAction: "enquiries.read",
  conversionRateBySourceAction: "enquiries.read",
  listOverdueFollowUpsAction: "enquiries.read",
  createEnquiryAction: "enquiries.write",
  transitionEnquiryStageAction: "enquiries.write",
  addFollowUpAction: "enquiries.write",
  completeFollowUpAction: "enquiries.write",
  bookTrialAction: "enquiries.write",
  convertEnquiryAction: "enquiries.write",

  // Sessions / scheduling
  listUpcomingSessionsAction: "attendance.read",
  cancelSessionAction: "attendance.mark",
  rescheduleSessionAction: "attendance.mark",
  substituteCoachAction: "programs.write",
  checkCoachConflictsAction: "programs.read",

  // Holidays
  addHolidayAction: "settings.manage",
  removeHolidayAction: "settings.manage",

  // Waitlists
  addToWaitlistAction: "enquiries.write",
  cancelWaitlistAction: "enquiries.write",
  getWaitlistHeadAction: "enquiries.read",
  promoteHeadAction: "enquiries.write",

  // Makeup credits
  grantMakeupCreditAction: "attendance.mark",
  redeemMakeupCreditAction: "attendance.mark",

  // Reports — the audit's "operator turning Reports off, CSV still
  // returns 200" case is gated by `reports.operational` (operational
  // reports the dashboard aggregates) and `reports.financial`
  // (accountant-grade reports). The CSV export was the worst offender
  // — `attendanceReportCsvAction` lives in owner-reports.ts and gets
  // reports.operational, not a separate permission.
  getAttendanceReportAction: "reports.operational",
  getEnquiryFunnelAction: "reports.operational",
  getRetentionViewAction: "reports.operational",
  getCoachLoadAction: "reports.operational",
  attendanceReportCsvAction: "reports.operational",

  // Owner dashboard
  getOwnerDashboardAction: "reports.operational",
  getOnboardingChecklistAction: "members.read",

  // Staff
  listStaffAction: "staff.read",
  createStaffAction: "staff.write",
  listInvitationsAction: "staff.invite",
  inviteStaffAction: "staff.invite",
  revokeInvitationAction: "staff.invite",
  resendInvitationAction: "staff.invite",
  issueLoginLinkAction: "staff.invite",

  // Tenant settings / config
  updateBrandingAction: "settings.manage",
  updateTermOverrideAction: "settings.manage",
  clearTermOverrideAction: "settings.manage",
  getTenantTimezoneAction: "members.read",
  getTerminologyAction: "members.read",
  getBrandingAction: "members.read",
};

// Pre-auth actions do not consult Ctx — they have no permission key.
// The platform side and the better-auth callbackOnVerification flow
// pass through here; the action-sweep test lists them explicitly as
// exempt so the second-statement check doesn't false-positive.
export const PRE_AUTH_ACTIONS = new Set([
  "loginPlatformAction", // password + email; no session to check
  "verifyPlatformTotpAction", // second-factor verify; first half-auth only
  "devCodeAction", // dev-only OTP peek, fails closed in production
  "issueParentLinkAction", // signed token IS the credential
  "homeForSessionAction", // resolves which surface this session belongs to
]);
