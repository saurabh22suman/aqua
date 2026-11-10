// POST-IMAGE — NEW FILE. NOT APPLIED, NOT COMPILED, NOT TYPECHECKED, NOT
// LINTED, NOT TESTED, NOT RUN.
//
// Proposed target:
//   lib/services/leave-owner-identity.ts
//
// ── HOW THIS FILE DIFFERS FROM THE REPAIRED POST-IMAGE ──────────────────────
//
// The CODE is unchanged. The independent review found no security
// regression in it, and this packet carries it unchanged. The COMMENTS are
// reconciled with the review's findings (each traced in
// docs/design/parallel-release/manager-owner-types-existing-identity-final-review-20261108/
// RECONCILIATION.md §2.1):
//
//   • this packet's directory in the two path references;
//   • the lock-order block (H2) — it said "the ONLY product writers that
//     take a membership row lock are …". That was FALSE: there are five
//     product writers, not two. The block now states the bounded CLASS —
//     every writer of `tenant_memberships` that changes `status`,
//     `role_id` or `links_valid_from` takes FOR NO KEY UPDATE, which
//     conflicts with FOR SHARE — and names the five writers as EVIDENCE
//     for it, not as an exhaustive list a future change could falsify;
//   • the re-key price paragraph (L5) — one sentence added: the preset
//     engine can REUSE the tenant's `owner` row and REPLACE its grants, so
//     a preset must never define a role whose slug is `owner` (condition
//     4.1);
//   • the owner-site inventory (H1) — the closer precedent is named, and
//     the full inventory is pointed at, not re-asserted here;
//   • the copy constant (M4) — the string is new product copy and has an
//     open copy owner;
//   • the ordering invariant and its owner (L2).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS MODULE IS
//
// ONE predicate: "is this caller the club's owner, right now?"
//
// It answers that question from the caller's OWN live membership and the
// LIVE role row that membership names. It reads nothing from the context's
// role claim, its role id, its membership id or its permission set.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE OWNER IS A ROLE ROW AND NOT A GRANT
//
// The product already answers "who is this club's owner?" from the role
// row, in five OWNER-IDENTITY places:
//
//   • the sole-owner guard on revocation  (lib/services/staff-invitations.ts:529, :537)
//   • the owner recovery list            (lib/services/owner-reset.ts:61)
//   • owner credential issuance          (lib/services/invite-link-issue.ts:361)
//   • owner credential redemption        (lib/services/invite-link.ts:241)
//   • the platform's own invite-owner    (db/tenant-invite.ts:141-153)
//
// Each of them reads `roles.key = 'owner'` on the row the membership
// names. This module reads the same row, for one more surface.
//
// The CLOSEST existing precedent is not one of those five: it is the
// role→surface map (lib/auth/surface-access.ts:56-88) as used by
// `requireSurface` (lib/auth/surface-guard.ts:41-53), which decides — with
// `notFound()` — who may open a tenant surface at all. On the leave
// catalogue's own page that map is the gate, and `admin` maps to the owner
// surface. The complete inventory of the product's role-name sites — the
// owner-identity ones, the page-level authorisation gates, the
// context-claim owner/admin refusals, the scope normalisations, the
// presentation/label lookups and the routing/analytics uses — is in
// docs/design/parallel-release/manager-owner-types-existing-identity-final-review-20261108/
// OWNER-IDENTITY-EXCEPTION.md §3. This module is STRICTER than every site
// it is compared with there: it reads a LIVE membership and a LIVE role
// row, and it filters a soft-deleted membership and a soft-deleted role.
//
// The alternative — a new, unique-per-tenant capability key on the grant
// table — was proposed and independently reviewed to a NO-GO: a unique
// index proves AT MOST ONE HOLDER, not THAT THE HOLDER IS THE OWNER, and
// the grant can be moved by a DELETE+INSERT that the index permits.
//
// The role row does not have that hole:
//
//   • `roles` has UNIQUE (tenant_id, key) (db/schema/roles.ts:40), so a
//     tenant has AT MOST ONE role whose key is 'owner'. There is no second
//     holder to create, and no "move the grant" operation, because there
//     is no grant.
//   • the holder is not "whoever was granted it" — it is the role the
//     product's owner-identity call sites already mean by "the owner".
//
// The price is a role-name branch, and the exception is named in
// docs/design/parallel-release/manager-owner-types-existing-identity-final-review-20261108/
// OWNER-IDENTITY-EXCEPTION.md. It is NOT granted by this file.
//
// The OTHER price, priced in full in the exception §4.1: `roles.key` is
// RE-KEYABLE — F-04's Done-when is "a role renamed or re-keyed after
// seeding still resolves the correct home path"
// (docs/implementation-plan.md:263), and the protected suite performs that
// re-key on the role whose key is 'owner'
// (tests/tier1/user-scope.test.ts:170-182). No PRODUCT surface writes
// `roles.key` today, so the escalation is not reachable through the
// product; the moment a writer of that column exists it is. That is what
// the exception's review condition 4.1 binds.
//
// And one more, an AVAILABILITY hazard rather than an escalation: the preset
// engine resolves a preset role by slug (db/preset-engine.ts:362-388,
// slugify at :811-817 — "Owner" becomes "owner"), REUSES an existing role
// row with that key (:364-371) and then REPLACES that role's entire grant
// set (:389-409). A preset that ever defined a role named "Owner" would
// therefore take over the tenant's owner row and strip its grants — the
// owner would lose `staff.roster`, and with it the action path. No preset
// defines such a role today; condition 4.1 forbids one.
//
// ─────────────────────────────────────────────────────────────────────────────
// F-04 / F-03a — THE EXCEPTION THIS FILE DEPENDS ON
//
//   "Never: hard-code behaviour to a role name anywhere in the codebase."
//     — docs/implementation-plan.md:264 (F-04)
//   "Never: leave a code path that resolves authorization from a role name
//    string."
//     — docs/implementation-plan.md:274 (F-03a)
//   "Roles are seeded per tenant from templates and are editable. Nothing is
//    hard-coded to a role name."
//     — docs/architecture.md:363
//
// THIS FILE IS THAT EXCEPTION, for ONE surface, and it is only valid once
// the exception is recorded. The exception's exact scope, its review
// conditions and its security implications are in
// docs/design/parallel-release/manager-owner-types-existing-identity-final-review-20261108/
// OWNER-IDENTITY-EXCEPTION.md.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SOURCES THIS FILE REFUSES TO READ
//
//   ctx.roleKey      — an arbitrary string; the product forbids trusting it
//                      over the membership row (lib/services/location-access.ts:175-181).
//                      The product itself still branches on it in three
//                      places (lib/services/attendance-mark.ts:20,
//                      lib/actions/coach.ts:213,
//                      lib/actions/parent-link.ts:45) — this predicate is
//                      stricter than each of them.
//   ctx.roleId       — a snapshot of a role id, not the caller's role
//   ctx.membershipId — a snapshot of a membership id, not the caller's membership
//   ctx.permissions  — a request-scoped snapshot resolved once per request
//                      (lib/auth/permission.ts:104-149); the wrong answer for
//                      a service, and not reachable from one
//
// The membership row is the authority. The context may only narrow it.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE SCOPE, SEQUENTIALLY — NOT NESTED
//
// `callerIsLiveOwner(ctx)` opens its OWN tenant transaction, and the
// service opens another one afterwards. They are SEQUENTIAL, never nested:
// the product's scope guard (db/scope.ts:56-72) throws if a `tenant` scope
// is entered while another `tenant` or `user` scope is already active.
// `requireDefaultCtx()` has already returned by the time the check runs —
// its own `withUser` scope (db/platform.ts:237) has closed.
//
// The invariant, and its owner: the action's owner check and the service's
// `withTenant` must stay SEQUENTIAL. `db/scope.ts:65-69` throws — a 500,
// NOT a refusal — if a tenant scope is ever entered inside another. Any
// future change that merges the two reads into one transaction, or that
// opens the two scopes concurrently (`Promise.all`), breaks the invariant
// and turns an authorisation failure into a server error. Owner: this lane,
// with the platform/data-layer owner.
//
// ─────────────────────────────────────────────────────────────────────────────

import { and, eq, isNull } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import type { ActionCtx } from "@/lib/auth/context";

// The literal existing owner designation. One constant, one literal, one
// product surface. It is the SAME string the owner-identity call sites
// above already use, so the product keeps ONE definition of "the owner"
// instead of two competing ones.
export const OWNER_ROLE_KEY = "owner";

// ONE refusal string for EVERY refusal this predicate can produce: no
// membership, a membership in another club, a revoked membership, a
// soft-deleted membership, a soft-deleted role, a role that is not the
// owner, and an identity-free caller. A club-wide object has no business
// telling a non-owner how close it came.
//
// The service's own contract is `{ ok: false, error }` (lib/services/leave-types.ts:37-39),
// so the refusal is a RESULT, never a throw: a refusal that throws would
// roll the transaction back and surface as an unhandled error at the
// action layer.
//
// COPY OWNERSHIP: this string is NEW product copy — the repository has no
// i18n layer, and the editor renders it verbatim in a role="alert"
// paragraph (components/leave-types-editor.tsx:202-206). Its copy owner is
// NOT yet assigned, and the agent-owned cases pin the exact string, so
// changing it later is a test-breaking change. The alternative — reusing an
// existing product string — is on the table. See the packet's approval A7.
export const OWNER_WRITE_REFUSAL = "Not authorized.";

// The caller's OWN membership in THIS tenant, and the LIVE role row that
// membership names.
//
// Every conjunct is a live database read inside the caller's own
// withTenant() transaction (db/tenant.ts:10-28), tenant-named explicitly,
// with `tenant_memberships` and `roles` under forced RLS
// (db/migrations/0009_roles_permissions.sql:18-23 for `roles`;
// db/migrations/0003_core_schema.sql:77-78 for `tenant_memberships`) as a
// second, independent confinement.
//
// The row lock is FOR SHARE. It is what makes the answer ORDINARY under a
// concurrent change: a revocation (lib/services/staff-invitations.ts:553-561)
// and a role reassignment (lib/services/curriculum-lead.ts:209-217) both
// UPDATE `tenant_memberships`, and FOR NO KEY UPDATE conflicts with FOR
// SHARE, so such a change is ordered strictly BEFORE or AFTER this write
// and never straddles it.
//
// THE BOUNDED LOCK SET (not an assertion — a checkable bound):
//
//   • membership rows locked here: AT MOST ONE. `tenant_memberships` is
//     UNIQUE (tenant_id, user_id) (db/schema/memberships.ts:46) and this
//     query names both columns;
//   • role rows locked here: AT MOST ONE. `roles` is UNIQUE (tenant_id, key)
//     (db/schema/roles.ts:40);
//   • EVERY product writer that UPDATEs `tenant_memberships` changes only
//     `status`, `role_id`, `links_valid_from`, `updated_at` or `updated_by`
//     — none of which is in a unique index on that table (the only unique
//     indexes are (tenant_id, user_id) and (id, tenant_id),
//     db/schema/memberships.ts:45-52) — so each of them takes FOR NO KEY
//     UPDATE, which CONFLICTS WITH FOR SHARE. The five writers that exist
//     today are named here as EVIDENCE for that class, not as an
//     exhaustive list:
//       lib/services/staff-invitations.ts:553-561   (status -> 'revoked')
//       lib/services/staff-invitations.ts:819-832   (status -> 'invited',
//                                                      a reactivation)
//       lib/services/invite-link.ts:271-280          (status -> 'active')
//       db/membership-activation.ts:55-65            (status -> 'active')
//       lib/services/curriculum-lead.ts:209-217      (role_id)
//   • NONE of those writers takes a role-row lock (their role reads are
//     plain SELECTs), and no writer holds a `leave_types` lock and then
//     asks for a membership lock.
//
// LOCK ORDER: membership (M) → role (R) → leave_types (T). Nothing in the
// product takes these locks in the opposite order, because no writer holds
// a `leave_types` lock and then asks for a membership lock.
//
// LIVENESS under READ COMMITTED: if the blocking transaction COMMITTED a
// revocation, the blocked `SELECT … FOR SHARE` re-evaluates its WHERE
// clause on the new row version (EvalPlanQual) and SKIPS the row, because
// `status = 'active'` no longer matches. The gate therefore receives ZERO
// ROWS — it never observes `status = 'revoked'`. The outcome is a refusal,
// and the refusal does not depend on that mechanism being visible.
export async function callerIsLiveOwnerInTx(
  tx: TenantTx,
  ctx: ActionCtx,
): Promise<boolean> {
  // A write is a human act. An identity-free caller carries no membership
  // and therefore no authority — the house precedent is the leave decision
  // (lib/services/leave-decision.ts:100-104).
  const userId = ctx.userId;
  if (!userId) return false;

  const rows = await tx
    .select({ membershipId: tenantMemberships.id })
    .from(tenantMemberships)
    .innerJoin(
      roles,
      and(
        eq(roles.id, tenantMemberships.roleId),
        // The role is the tenant's own. The composite foreign key
        // (tenant_memberships_role_tenant_fkey, db/schema/memberships.ts:48-52)
        // already forbids a membership pointing at another tenant's role;
        // naming the tenant again makes the isolation explicit at the read.
        eq(roles.tenantId, tenantMemberships.tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.userId, userId),
        // The membership is LIVE: active, and not soft-deleted. A revoked
        // or deleted membership grants nothing.
        eq(tenantMemberships.status, "active"),
        isNull(tenantMemberships.deletedAt),
        // The ROLE is LIVE. A soft-deleted role grants nothing — the gap
        // the shared resolvers still have (lib/services/location-access.ts:246-284;
        // db/platform.ts:237-279) is closed HERE, in this predicate.
        isNull(roles.deletedAt),
        // The one literal. See the F-04 / F-03a note above.
        eq(roles.key, OWNER_ROLE_KEY),
      ),
    )
    .limit(1)
    .for("share");

  return rows.length > 0;
}

// The same predicate in its own transaction, for a caller that is not
// already inside one (the action layer).
//
// This check is a fast pre-filter, NOT the authoritative one: the service
// re-reads the membership inside the transaction that performs the write,
// so the service's answer is the one that decides. The action's answer can
// only ever be MORE restrictive than the service's, by the passage of time
// between the two reads.
//
// It opens its OWN tenant scope, which must stay SEQUENTIAL with the
// service's — see "ONE SCOPE, SEQUENTIALLY — NOT NESTED" above.
export async function callerIsLiveOwner(ctx: ActionCtx): Promise<boolean> {
  return withTenant(ctx.tenantId, (tx) => callerIsLiveOwnerInTx(tx, ctx));
}
