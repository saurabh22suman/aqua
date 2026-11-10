// The facility manager's canonical role definition.
//
// ONE definition of the manager role key, its home route, its priority and
// its 24 permission keys. The role template (lib/services/roles.ts), the
// facility-scope registry (lib/services/facility-scope.ts), the agent-owned
// contract (tests/parallel-release/manager/manager-contract.ts) and the
// rollout migration all read this list, so a key cannot be added to one and
// forgotten in another.
//
// ── WHAT THE MANAGER IS ────────────────────────────────────────────────
//
// The human's decision (9 November 2026): a manager performs OWNER
// operational capabilities inside SPECIFICALLY ASSIGNED facilities.
// Club-wide settings and access delegation stay with the owner.
//
// "Owner-equivalent" is bounded by three things, and all three are data,
// not branches:
//
//   • the GRANT SET below — the owner powers a manager may exercise;
//   • the FACILITY SCOPE — the manager's own membership names its
//     facilities, and lib/services/facility-scope.ts binds the 'manager'
//     role key to them unconditionally (the tenant-wide switch neither
//     widens nor narrows it);
//   • the APPOINTMENT — only a live owner may appoint one, and only with
//     at least one live facility of this academy (lib/services/
//     manager-appointment.ts).
//
// ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────
//
//   settings.read / settings.manage  club-wide settings, branding, the
//                                    payment QRs, the config registry
//   programs.write                    the programme catalogue is tenant-wide
//   staff.invite / staff.write        access delegation and staff records
//   staff.pay.read / staff.pay.write  payroll has no facility dimension
//   messaging.send / messaging.templates  announcements fan out tenant-wide
//   levels.write                      the curriculum framework is academy-wide
//   attendance.mark                   execution duty the owner does not hold
//   members.delete                    no Server Action requires it today
//
// A manager therefore CANNOT delegate: it does not carry staff.invite.
//
// ── WHY A SHARED CONSTANT AND NOT A SECOND DEFINITION ──────────────────
//
// The grant set is a PRODUCT decision, so it lives in the product rather
// than in a test. The rollout migration cannot import TypeScript, so its
// SQL carries the same 24 keys literally; the preset contract test pins
// the SQL list and this list against each other by name, so the two
// cannot drift apart unnoticed.
//
// This module has NO imports. It is data, and it must stay importable
// from the migration's test without dragging a dependency graph in.

export const MANAGER_ROLE_KEY = "manager" as const;

/**
 * The manager works in the OWNER surface.
 *
 * It is a delegate, not a coach: its pages, navigation and route guards
 * are the owner's, because the capabilities it exercises are the owner's.
 * lib/auth/surface-access.ts carries the role→surface map that decides
 * which surface a signed-in manager may open at all.
 */
export const MANAGER_HOME_PATH = "/owner" as const;

/**
 * The tie-break priority when a user holds several memberships.
 *
 * 0 = owner, 1 = administrator and manager, 2 = coach and curriculum lead,
 * 3 = the rest. The manager sits WITH the administrator: below the owner,
 * above the coach and the reception.
 */
export const MANAGER_HOME_ORDINAL = 1;

/**
 * The 24 canonical keys the manager role carries.
 *
 * The order is the catalogue's own reading order (members, attendance,
 * programs, enquiries, money, bookings, reports, levels, surface, staff)
 * and is not load-bearing: the grant set is a SET, and the preset
 * contract test compares sets, not lists.
 *
 * Every key here is in the closed permission catalogue
 * (db/seed-platform.ts PERMISSIONS), so `role_permissions.permission_key`
 * resolves against a real `permissions` row.
 */
export const MANAGER_PERMISSION_KEYS = [
  // People
  "members.read",
  "members.read.assigned",
  "members.write",
  "members.link.confirm",
  // Attendance and programmes
  "attendance.read",
  "programs.read",
  // Enquiries
  "enquiries.read",
  "enquiries.write",
  // Money — the owner's own operational money powers, bounded to the
  // manager's facilities by the service layer's facility predicates.
  "invoices.read",
  "payments.read",
  "payments.record",
  "payments.refund",
  "invoices.write",
  "reports.financial",
  // Bookings and operations
  "bookings.read",
  "bookings.write",
  "reports.operational",
  // Levels — the shared skill ladder, read and assess
  "levels.read",
  "levels.assess",
  // The surface
  "dashboard.view",
  // Staff — the manager's own record, and the facility-scoped staff reads,
  // the day board and the roster/leave queue behind them.
  "staff.self",
  "staff.read",
  "staff.attendance",
  "staff.roster",
] as const;

export type ManagerPermissionKey = (typeof MANAGER_PERMISSION_KEYS)[number];
