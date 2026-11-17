// WHO MAY DECIDE, AND WHAT THEY MAY SEE.
//
// EVERY branch of this module is derived from ONE resolver:
// `resolveLocationAccess` (lib/services/location-access.ts:156-220).
// There is no second answer to "what may this caller reach" anywhere
// in the leave slice, and no local branch that invents one. The
// resolver's three answers become the caller kinds the leave services
// need:
//
//   resolver answer            caller kind      what it may do
//   ────────────────────────── ──────────────── ───────────────────────────
//   unrestricted, system actor  system           read the whole tenant;
//                                               never decide
//   unrestricted, no identity   identity-free    read the whole tenant while
//                                               the switch is OFF; never decide
//   unrestricted, live human    tenant           read AND decide over the
//                                               whole tenant
//   denied                     refused          nothing at all
//   scoped, includeUnlocated   legacy-scoped    read AND decide inside its
//     = false                                     own facilities
//   scoped, includeUnlocated   legacy-scoped    read AND decide inside its
//     = true                                      own facilities, plus the
//                                                whole-business rows
//
// TWO IDENTITY-FREE PATHS, NOT ONE.
//
// The resolver answers `unrestricted` for an explicit
// `systemActor: true` caller (:163) and `denied` for the legacy
// identity-free internal path while the O-08 switch is ON (:169-173).
// The leave services must keep the two apart: the switch governs one
// of them and not the other, and a service that collapses them is
// answering a question the resolver already answered.
//
// THE LIVENESS RULE IS INHERITED, NOT RE-IMPLEMENTED.
//
// The resolver refuses a missing, revoked or soft-deleted membership
// BEFORE it answers `unrestricted` (:184-203), so a caller without a
// live membership reaches `denied` here and is refused — for every
// role, not only for the facility-scoped one. There is no second
// liveness check to drift.
//
// THE QUEUE'S VISIBILITY AND THE DECISION'S FOOTPRINT ARE THE SAME
// CRITERION — FOR THE FACILITY-SCOPED MANAGER.
//
// This is the I-4 CORRECTION. The earlier draft of this module gave
// the queue and the decision DELIBERATELY DIFFERENT predicates: the
// queue keyed on the decided person's ATTACHMENT (`staff_locations`)
// and the decision keyed on the request's AFFECTED SHIFT ROWS'
// FACILITIES. The consequence was that a facility-scoped manager's
// REACHABLE set was LARGER than its VISIBLE set — it could DECIDE (by
// id) a request its QUEUE did not list and whose PREVIEW was empty.
//
// The human's settled rule removes that asymmetry:
//
//   • a leave request goes to an OWNER, or to a MANAGER who covers
//     EVERY facility of the request's AFFECTED SHIFTS;
//   • the decided person's OTHER assignments are NOT part of the
//     footprint; and
//   • a manager who may decide must be able to SEE that request, and
//     its IN-SCOPE preview.
//
// So for the manager the queue's answer is the SAME criterion the
// decision uses, stated as a CORRELATED criterion over the request
// row:
//
//   • the request AFFECTS at least one shift — a request with no
//     affected shift is OWNER-ONLY (settled rule R3), and an
//     owner-only request is not in a manager's queue; and
//   • EVERY affected shift's facility is one the manager holds — an
//     affected facility outside the manager's selection needs an
//     owner, or a manager whose own facilities cover EVERY affected
//     facility (settled rule R2).
//
// The attachment of the decided person is NOT a dimension of either
// half, and this module deliberately does not export a predicate that
// would say so. A person who also works at a facility outside the
// caller's scope neither widens the request nor narrows it.
//
// THE LEGACY O-08 NON-MANAGER HALF IS UNCHANGED.
//
// The location-scoped NON-facility role keeps the repository's own
// staff-list predicate (`staffScopePredicate`) and the canonical
// `includeUnlocated` half. That half is the house rule the O-08
// surfaces have always meant, it is pinned by another lane's file
// (tests/parallel-release/manager/manager-leave-canonical-scope-red-20261107.test.ts),
// and this correction does not move it.

import { and, between, eq, exists, notExists, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgColumn } from "drizzle-orm/pg-core";
import type { TenantTx } from "@/db/tenant";
import { shifts } from "@/db/schema/shifts";
import { staffLocations } from "@/db/schema/staff-locations";
import type { TenantId } from "@/lib/ids";
import {
  locationPredicate,
  resolveCallerMembership,
  resolveLocationAccess,
  type LocationAccess,
  type LocationAwareCtx,
} from "./location-access";
import { isFacilityScopedRoleKey } from "./facility-scope";
import { staffScopePredicate } from "./staff-scope";

// The scoped member of the resolver's union. `denied` is a separate
// answer and never travels with a scope: a denied caller is refused
// before it reaches a scope.
export type ScopedAccess = Extract<LocationAccess, { unrestricted: false }>;

// WHO IS DECIDING.
//
//   tenant         — a live human with whole-tenant authority (an
//                    owner/admin whose membership is all-locations, or
//                    any role on a switch-off tenant). Today's owner
//                    behaviour, unchanged.
//   system         — the explicit `systemActor: true` caller. It has
//                    no membership, so it can never be a decider. The
//                    READS keep the whole-tenant answer.
//   identity-free  — the legacy identity-free internal path. The READS
//                    keep the whole-tenant answer while the switch is
//                    OFF and see NOTHING while it is ON.
//   manager        — a facility-scoped role (lib/services/
//                    facility-scope.ts:16) with a live membership.
//   legacy-scoped  — a location-scoped NON-facility role with a live
//                    membership and the switch ON.
//   refused        — nothing may be decided AND nothing may be read.
export type LeaveCaller =
  | { kind: "tenant" }
  | { kind: "system" }
  | { kind: "identity-free" }
  | { kind: "manager"; membershipId: string; access: ScopedAccess }
  | { kind: "legacy-scoped"; membershipId: string; access: ScopedAccess }
  | { kind: "refused"; error: string };

// The two kinds that decide inside a scope rather than over the whole
// tenant.
export type ScopedCaller = Extract<
  LeaveCaller,
  { kind: "manager" | "legacy-scoped" }
>;

// The caller's authority, resolved ONCE per call, from the ONE
// resolver.
//
// The membership row is read a second time, unfiltered by status, only
// for a SCOPED caller, and only to learn the ROLE KEY: the resolver
// does not expose it, and the role decides the SHAPE of the scope
// (facility-scoped vs legacy O-08). The second read is deliberately
// unfiltered so a revoked or deleted membership is still FOUND and
// refused explicitly. The outcome if the row changes between the two
// reads is fail-closed: the second read refuses it.
export async function resolveLeaveCaller(
  tx: TenantTx,
  ctx: LocationAwareCtx,
): Promise<LeaveCaller> {
  // ── THE CANONICAL ANSWER, UNCHANGED AND UNPARAMETERISED ──────────────
  const access = await resolveLocationAccess(tx, ctx);

  // ── THE IDENTITY-FREE PATHS ───────────────────────────────────────────
  if (!ctx.userId) {
    if (ctx.systemActor === true) {
      // A job must identify itself explicitly. The resolver answers
      // `unrestricted` for it (:163).
      if (access.unrestricted) return { kind: "system" };
      return { kind: "refused", error: "Not authorized." };
    }
    // The legacy identity-free internal path. The resolver answers
    // `denied` while the switch is ON and `unrestricted` while it is
    // OFF (:169-173): the switch governs this path, and it must keep
    // governing it here.
    if (access.unrestricted) return { kind: "identity-free" };
    return { kind: "refused", error: "Not authorized." };
  }

  // ── A HUMAN CALLER ────────────────────────────────────────────────────
  //
  // The resolver has already refused a missing, revoked or deleted
  // membership, so `unrestricted` and `scoped` are reachable only by a
  // LIVE membership. That is the liveness rule, inherited.
  if (access.unrestricted) return { kind: "tenant" };
  if (access.denied) return { kind: "refused", error: "Not authorized." };

  // ── A SCOPED CALLER ───────────────────────────────────────────────────
  const membership = await resolveCallerMembership(tx, ctx);
  if (!membership) return { kind: "refused", error: "Not authorized." };
  if (membership.status !== "active" || membership.deleted) {
    return { kind: "refused", error: "Not authorized." };
  }
  if (isFacilityScopedRoleKey(membership.roleKey)) {
    return { kind: "manager", membershipId: membership.id, access };
  }
  return { kind: "legacy-scoped", membershipId: membership.id, access };
}

// Is this caller one that decides inside a scope?
export function isScopedCaller(
  caller: LeaveCaller,
): caller is ScopedCaller {
  return caller.kind === "manager" || caller.kind === "legacy-scoped";
}

// THE REQUEST'S OWN COLUMNS.
//
// The corrected criterion is CORRELATED with the request row: the
// subquery names the request's own staff member and the request's own
// date range, so it cannot drift from the decision's footprint
// (`leave-decision-evidence.ts`'s `affectedShiftsInRange` reads the same
// rows with the same range and the same tenant predicate).
//
// The columns are passed in rather than imported so that the criterion
// stays bound to the query it is used in, and so that a future call
// site against a different table is a TYPE error rather than a silent
// correlation against `leave_requests`.
export type LeaveRequestColumns = {
  /** The request's `staff_id` — the person whose shifts the request affects. */
  staffIdColumn: AnyPgColumn;
  /** The request's `from_date` — the first day of the affected range. */
  fromDateColumn: AnyPgColumn;
  /** The request's `to_date` — the last day of the affected range. */
  toDateColumn: AnyPgColumn;
};

// THE MANAGER'S HALF — THE CORRELATED AFFECTED-SHIFTS CRITERION.
//
// A request is visible to a facility-scoped manager exactly when that
// manager may DECIDE it:
//
//   • the request AFFECTS AT LEAST ONE shift. A request with no
//     affected shift is OWNER-ONLY (settled rule R3), and an
//     owner-only request does not belong in a manager's queue.
//   • EVERY affected shift's facility is one the manager holds. An
//     affected facility outside the manager's selection needs an owner,
//     or a manager whose own facilities cover EVERY affected facility
//     (settled rule R2). A manager that covers only PART of the
//     footprint does not get the request.
//
// The decided person's ATTACHMENT is not a dimension of either half:
// where the person happens to work is not what the request's scope is
// made of.
//
// TWO SUBQUERIES, ONE CRITERION:
//
//   • the FIRST asks whether the request affects any shift at all;
//   • the SECOND asks whether the request affects any shift whose
//     facility is OUTSIDE the caller's selection.
//
// Together they are "the affected set is non-empty AND every affected
// facility is covered". Each subquery names the tenant, the request's
// own staff member and the request's own date range, so the criterion
// and the decision's footprint read the SAME rows.
//
// A shift carries a NOT NULL location (`shifts.location_id` is NOT
// NULL), so "not covered" is a total test and needs no NULL branch. The
// `not (...)` is written over the canonical `locationPredicate`, so the
// criterion keeps the canonical answer's own shape for whatever access
// it is given.
export function affectedFacilityPredicate(
  tx: TenantTx,
  request: LeaveRequestColumns,
  access: ScopedAccess,
  tenantId: TenantId,
): SQL {
  // A blank appointment is not "every facility": an empty selection sees
  // nothing, exactly as the canonical answer says. The empty case
  // answers `false`, never an empty IN list.
  if (access.locationIds.length === 0) return sql`false`;

  // The canonical answer's own predicate for this column: the caller's
  // own facilities, plus the whole-business rows only while the
  // canonical answer says `includeUnlocated`.
  const covered = locationPredicate(shifts.locationId, access) ?? sql`false`;

  const affectedConditions = (extra?: SQL) =>
    and(
      eq(shifts.tenantId, tenantId),
      eq(shifts.staffId, request.staffIdColumn),
      between(shifts.shiftDate, request.fromDateColumn, request.toDateColumn),
      extra,
    );

  const affectedSubquery = tx
    .select({ one: sql`1` })
    .from(shifts)
    .where(affectedConditions());
  const uncoveredSubquery = tx
    .select({ one: sql`1` })
    .from(shifts)
    .where(affectedConditions(sql`not (${covered})`));

  return (
    and(exists(affectedSubquery), notExists(uncoveredSubquery)) ?? sql`false`
  );
}

// THE QUEUE'S VISIBILITY PREDICATE.
//
// TWO HALVES, AND THEY ARE NOT THE SAME HALF.
//
//   • the FACILITY-SCOPED MANAGER is answered by the correlated
//     affected-shifts criterion above — the same criterion the decision
//     uses, so the manager's reachable set and its visible set are the
//     same set;
//   • the LEGACY O-08 NON-MANAGER keeps the repository's own
//     `staffScopePredicate` — the staff list's predicate — plus the
//     canonical `includeUnlocated` half, exactly as it was.
//
// The owner, the explicit system caller and the identity-free path are
// answered by NO predicate at all: they keep the whole-tenant answer.
export function leaveQueuePredicate(
  tx: TenantTx,
  request: LeaveRequestColumns,
  caller: LeaveCaller,
  tenantId: TenantId,
): SQL | undefined {
  if (!isScopedCaller(caller)) return undefined;

  // ── THE MANAGER: the affected-shifts criterion ───────────────────────
  if (caller.kind === "manager") {
    return affectedFacilityPredicate(tx, request, caller.access, tenantId);
  }

  // ── THE LEGACY O-08 NON-MANAGER: unchanged ───────────────────────────
  const access = caller.access;
  const inScope =
    staffScopePredicate(tx, request.staffIdColumn, access, tenantId) ??
    sql`false`;
  if (!access.includeUnlocated) return inScope;
  const unlocated = notExists(
    tx
      .select({ one: sql`1` })
      .from(staffLocations)
      .where(
        and(
          eq(staffLocations.tenantId, tenantId),
          eq(staffLocations.staffId, request.staffIdColumn),
        ),
      ),
  );
  return or(inScope, unlocated) ?? sql`false`;
}

// THE PREVIEW'S SESSION PREDICATE.
//
// A session carries its OWN `location_id`, and it is NULLABLE: a
// tenant-wide session belongs to the whole business. The canonical
// `locationPredicate` is exactly the right answer — the caller's
// facilities, plus the whole-business rows while the caller's answer
// says `includeUnlocated`. The session's OWN location decides the row,
// never the request's.
//
// This predicate is UNCHANGED by the I-4 correction: a session outside
// the caller's selection is not listed, and a session at a facility the
// caller holds is listed even when the REQUEST it belongs to was
// reached by a different route.
export function leaveSessionPredicate(
  locationIdColumn: PgColumn,
  caller: LeaveCaller,
): SQL | undefined {
  if (!isScopedCaller(caller)) return undefined;
  return locationPredicate(locationIdColumn, caller.access);
}
