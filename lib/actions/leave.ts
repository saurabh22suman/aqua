// POST-IMAGE — NOT APPLIED, NOT COMPILED, NOT TYPECHECKED, NOT LINTED, NOT
// TESTED, NOT RUN.
//
// Proposed target:
//   lib/actions/leave.ts
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
// RECONCILIATION.md §2.3):
//
//   • the "ONE SCOPE, SEQUENTIALLY — NOT NESTED" block → the invariant is
//     NAMED and given an OWNER (L2 / R7);
//   • the copy paragraph → the copy fix is stated as PARTIAL (M3 / R5): a
//     caller who LACKS `staff.roster` still receives the thrown
//     ForbiddenError and therefore the editor's UNCERTAIN copy;
//   • the copy ownership note (M4): "Not authorized." is new product copy
//     and has no assigned copy owner yet;
//   • the packet path in the residual/approval reference (M3).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE ACTION STILL CALLS requirePermission(ctx, "staff.roster")
//
// The action's permission key is pinned in three places that this lane may
// not touch:
//
//   • lib/auth/action-permissions.ts:193-194  (PROTECTED PATH — lib/auth/*)
//   • tests/tier1/server-action-preamble.test.ts:434-449 — the action's
//     requirePermission literal must EQUAL the map entry
//   • tests/tier1/server-action-preamble.test.ts:301-349 — parse < permission
//     < service, in that order
//
// There is no catalogue key that only the owner holds, and this alternative
// adds none. So the coarse grant precondition stays exactly where it is, and
// the OWNER rule is enforced by the second check below.
//
// The consequence, stated precisely: the action refuses (a) a caller without
// `staff.roster` — the pre-existing thrown ForbiddenError, unchanged — and
// (b) a caller who holds `staff.roster` but is not the live owner, with the
// service's uniform "Not authorized.". Both layers refuse exactly the same
// callers; the only difference is the SHAPE of the first refusal, which is
// the product's pre-existing two-stage shape and is not an oracle about
// ownership (a caller who lacks the grant is refused either way).
//
// THE COPY FIX IS PARTIAL, and the remainder is stated rather than hidden:
// the refusal for (b) is a RETURNED RESULT, not a throw, so the leave-type
// editor shows "Not authorized." rather than its UNCERTAIN copy
// ("Could not confirm whether the leave type was saved…" —
// components/leave-types-editor.tsx:18-21, :42-47). A policy refusal must
// not be reported as a lost response.
//
// But refusal (a) still THROWS, and the editor's `catch` maps a throw to the
// UNCERTAIN copy — so a caller who LACKS `staff.roster` still sees
// "Could not confirm whether the leave type was saved…" for what is a
// determinate policy refusal. That is a PRE-EXISTING editor defect, it is
// NOT introduced here, and it is NOT fixed here: the editor is not in this
// packet's diff. It is recorded as the packet's residual X11 and its
// approval A7.
//
// COPY OWNERSHIP: "Not authorized." is NEW product copy — the repository has
// no i18n layer, and the editor renders it verbatim in a role="alert"
// paragraph (components/leave-types-editor.tsx:202-206). Its copy owner is
// NOT yet assigned, and the agent-owned cases pin the exact string, so
// changing it later is a test-breaking change. The alternative — reusing an
// existing product string — is on the table.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE SCOPE, SEQUENTIALLY — NOT NESTED
//
// `callerIsLiveOwner(ctx)` opens its OWN tenant transaction, and the
// service opens another one afterwards. They are SEQUENTIAL, never nested:
// the product's scope guard (db/scope.ts:56-72) throws if a `tenant` scope
// is entered while another `tenant` or `user` scope is already active.
// `requireDefaultCtx()` has already returned by the time the check runs —
// its own `withUser` scope (db/platform.ts:237) has closed — so the two
// tenant scopes never overlap.
//
// THE INVARIANT, AND ITS OWNER: the action's `callerIsLiveOwner(ctx)` and
// the service's `withTenant` must stay SEQUENTIAL. `db/scope.ts:65-69`
// throws — a 500, NOT a refusal — if a tenant scope is entered inside
// another. Any future change that merges the two reads into one
// transaction, or that opens the two scopes concurrently (`Promise.all`),
// breaks the invariant and turns an authorisation failure into a server
// error. Owner: this lane, with the platform/data-layer owner.
//
// If a future implementation wants ONE transaction for both, the check
// must move INTO the service (it is already there) and the action's copy
// must be dropped; it must not be nested.
// ─────────────────────────────────────────────────────────────────────────────

"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  approveLeaveRequest,
  cancelLeaveRequest,
  createLeaveType,
  leaveDecisionInput,
  leaveListInput,
  leaveRequestIdInput,
  leaveRequestInput,
  leaveTypeInput,
  leaveTypeUpdateInput,
  leaveYearInput,
  listLeaveRequests,
  listLeaveTypes,
  listMyLeave,
  listUncoveredSessions,
  rejectLeaveRequest,
  requestLeave,
  updateLeaveType,
  type LeaveBalanceRow,
  type LeaveDecisionResult,
  type LeaveRequestResult,
  type LeaveRequestRow,
  type LeaveTypeResult,
  type LeaveTypeRow,
  type UncoveredSessionRow,
} from "@/lib/services/leave";
import {
  OWNER_WRITE_REFUSAL,
  callerIsLiveOwner,
} from "@/lib/services/leave-owner-identity";

// V-26 — leave actions. Standing preamble: (1) Zod parse, (2) a
// permission check before any service call. Staff request and cancel
// their own leave under staff.self; managing types and reading the
// request queue is staff.roster (owner/admin/worker-template).

const uuid = z.string().uuid();

export async function listLeaveTypesAction(): Promise<LeaveTypeRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return listLeaveTypes(ctx);
}

export async function createLeaveTypeAction(
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid leave type.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  // ── THE OWNER RULE, AT THE ACTION LAYER ───────────────────────────
  //
  // The leave-TYPE catalogue is club-wide, so its write is owner-only. The
  // check reads the caller's OWN live membership and the LIVE role row it
  // names — never ctx.roleKey, ctx.roleId or ctx.permissions.
  //
  // This is the same predicate the service runs, so the two layers answer
  // the same question the same way. The service re-checks inside the
  // transaction that writes, and THAT check is the authoritative one.
  if (!(await callerIsLiveOwner(ctx))) {
    return { ok: false, error: OWNER_WRITE_REFUSAL };
  }
  return createLeaveType(ctx, parsed.data);
}

export async function updateLeaveTypeAction(
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid leave type.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  // ── THE OWNER RULE, AT THE ACTION LAYER ───────────────────────────
  // The same predicate as the create action, and the same uniform refusal.
  if (!(await callerIsLiveOwner(ctx))) {
    return { ok: false, error: OWNER_WRITE_REFUSAL };
  }
  return updateLeaveType(ctx, parsed.data);
}

export async function requestLeaveAction(
  raw: unknown,
): Promise<LeaveRequestResult> {
  const parsed = leaveRequestInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid leave request." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return requestLeave(ctx, parsed.data);
}

export async function cancelLeaveRequestAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid leave request." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return cancelLeaveRequest(ctx, parsed.data);
}

export async function listMyLeaveAction(
  raw: unknown,
): Promise<{ balances: LeaveBalanceRow[]; requests: LeaveRequestRow[] }> {
  const parsed = leaveYearInput.safeParse(raw);
  if (!parsed.success) return { balances: [], requests: [] };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return listMyLeave(ctx, parsed.data);
}

export async function listLeaveRequestsAction(
  raw: unknown,
): Promise<LeaveRequestRow[]> {
  const parsed = leaveListInput.safeParse(raw ?? {});
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return listLeaveRequests(ctx, parsed.data);
}

// V-27 — the decision screen's uncovered-session read, and the
// approve/reject pair. All staff.roster (owner/admin).
export async function listUncoveredSessionsAction(
  raw: unknown,
): Promise<UncoveredSessionRow[]> {
  const parsed = leaveRequestIdInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return listUncoveredSessions(ctx, parsed.data);
}

export async function approveLeaveRequestAction(
  raw: unknown,
): Promise<LeaveDecisionResult> {
  const parsed = leaveDecisionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid decision.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return approveLeaveRequest(ctx, parsed.data);
}

export async function rejectLeaveRequestAction(
  raw: unknown,
): Promise<LeaveDecisionResult> {
  const parsed = leaveDecisionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid decision.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return rejectLeaveRequest(ctx, parsed.data);
}
