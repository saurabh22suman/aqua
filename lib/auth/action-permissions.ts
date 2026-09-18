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
  listHolidaysAction: "settings.manage",
  addHolidayAction: "settings.manage",
  removeHolidayAction: "settings.manage",

  // Waitlists
  addToWaitlistAction: "enquiries.write",
  cancelWaitlistAction: "enquiries.write",
  getWaitlistHeadAction: "enquiries.read",
  listWaitlistAction: "enquiries.read",

  // Makeup credits (R.7)
  listMakeupCreditsAction: "attendance.read",
  listMakeupSourcesAction: "attendance.read",
  listMakeupTargetsAction: "attendance.read",

  // Absence alerts (R.8)
  getAbsenceAlertThresholdAction: "settings.manage",
  updateAbsenceAlertThresholdAction: "settings.manage",
  listMemberAlertsAction: "members.read.assigned",
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

  // U-05 — global search. `members.read` is the coarse gate the whole
  // search surface rides on (the box lives in the owner shell); the
  // per-kind checks (enquiries.read, invoices.read) happen inside
  // lib/services/global-search.ts against ctx.permissions.
  globalSearchAction: "members.read",

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

  // O-07 — registry-rendered owner settings + change requests.
  listOwnerVisibleConfigAction: "settings.read",
  setOwnerConfigValueAction: "settings.manage",
  requestConfigChangeAction: "settings.manage",

  // C-35 — payment QRs. Reception reads for the collect screen;
  // owner/admin manage.
  listPaymentQrsAction: "settings.read",
  createPaymentQrAction: "settings.manage",
  updatePaymentQrAction: "settings.manage",
  deletePaymentQrAction: "settings.manage",

  // C-29 — membership plans. The member subscription panel reads
  // plans for its picker; owner/admin manage them.
  listPlansAction: "settings.read",
  listPlanTemplatesAction: "settings.read",
  activatePlanFromShapeAction: "settings.manage",
  createPlanAction: "settings.manage",
  updatePlanAction: "settings.manage",
  archivePlanAction: "settings.manage",

  // C-30 — subscriptions. Owner/admin/receptionist start and manage
  // them at the desk.
  listMemberSubscriptionsAction: "members.read",
  createSubscriptionAction: "members.write",
  pauseSubscriptionAction: "members.write",
  resumeSubscriptionAction: "members.write",
  cancelSubscriptionAction: "members.write",

  // Activity catalog (2026-09-14).
  listActivitiesAction: "settings.read",
  createActivityAction: "settings.manage",
  updateActivityAction: "settings.manage",
  deleteActivityAction: "settings.manage",
  addSubUnitAction: "settings.manage",
  removeSubUnitAction: "settings.manage",

  // C-32/C-33 — invoices and counter payments. Reception holds
  // invoices.read + payments.record; accountant/owner/admin hold the
  // write set; the daily collection report is accountant-grade
  // (reports.financial).
  listMemberInvoicesAction: "invoices.read",
  getInvoiceAction: "invoices.read",
  createInvoiceAction: "invoices.write",
  voidInvoiceAction: "invoices.write",
  listInvoicePaymentsAction: "invoices.read",
  recordPaymentAction: "payments.record",
  getDailyCollectionAction: "reports.financial",
  confirmCashCountAction: "payments.record",
  // Reopening a closed count is the escape hatch a dishonest recount
  // would want — owner/admin-only, same gate as an over-₹2,000 close.
  reopenCashCountAction: "settings.manage",
  listCashCountHistoryAction: "reports.financial",

  // K-01 — café menu. Reception reads the menu for the counter
  // (settings.read); owner/admin manage it (settings.manage).
  listMenuAction: "settings.read",
  createMenuCategoryAction: "settings.manage",
  updateMenuCategoryAction: "settings.manage",
  archiveMenuCategoryAction: "settings.manage",
  createMenuItemAction: "settings.manage",
  updateMenuItemAction: "settings.manage",
  archiveMenuItemAction: "settings.manage",

  // K-02/K-03 — counter orders and the invoice bridge. Counter work
  // rides payments.record, the same permission that settles the bill.
  createOrderAction: "payments.record",
  finalizeOrderAction: "payments.record",
  voidOrderAction: "payments.record",
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
