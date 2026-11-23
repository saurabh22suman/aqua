-- members_link_confirm_grant
-- POSTIMAGE — db/migrations/20261108210140_members_link_confirm_grant.sql  (candidate, NOT applied)
--
-- The authority the 7 November 2026 decision creates, and the catalogue
-- row that carries it.
--
-- PROPOSED FILENAME. The coordinator mints and validates the final name;
-- it must sort after 20261109100300.
--
-- THE KEY IS NEW, NOT REUSED
--   members.write is "Create and edit member records". A confirmation
--   EDITS NO MEMBER RECORD - it edits a link's attestation. Reusing
--   members.write would hand the new privilege to every role that can
--   edit a member (the RECEPTIONIST holds it - lib/services/roles.ts),
--   which is exactly the widening the human's decision does not
--   authorise.
--
-- WHY module: 'members'
--   The module must be an F-01 feature key, and 'members' is in
--   ALWAYS_ON_MODULES (lib/auth/permission.ts:42), so the grant is not
--   entangled with a tenant's feature entitlement. The action therefore
--   fails closed on the ROLE GRANT alone, which is the correct shape for
--   a privilege like this.
--
-- WHY A KEY OUTSIDE THE CLOSED LIST FAILS CLOSED
--   requirePermission resolves the module from the closed PERMISSIONS
--   list and throws ForbiddenError('role_grant_missing') when the key is
--   not in it (lib/auth/permission.ts:80-86). A typo in this migration
--   is therefore a REFUSAL, not a hole.
--
-- THE DESCRIPTION STRING IS CHARACTER-FOR-CHARACTER THE SEED'S
--   The seed's upsert overwrites the description, so the two must be
--   identical or the row's description depends on which ran last. It is
--   the same string as db/seed-platform.ts's PERMISSIONS entry (see
--   files/db/seed-platform.ts.txt).
--
--   WHAT NO TEST CHECKS: no test in this repository compares
--   permissions.description. tests/db/catalogue-parity.test.ts compares
--   the COUNT and the KEY SET; tests/tier1/platform-entitlements.test.ts
--   compares the COUNT and the KEY LIST; tests/tier1/roles-permissions.
--   test.ts compares the ROLE GRANT SETS. The two strings are identical
--   anyway, so nothing breaks - but the claim that a differing description
--   would fail a test is wrong, and it is not made again here.
--
-- THE BACKFILL PREDICATE IS THE ROLE KEY AND A LIVE ROLE
--   `roles.key = 'owner'`, with NO is_system filter. roles.is_system
--   DEFAULTS TO FALSE (db/schema/roles.ts:30), so a tenant whose owner
--   role was not created by the system seeder would receive NO grant and
--   the feature would be dead there WITH NO SIGNAL.
--
--   `and r.deleted_at is null` IS in the predicate. `roles` is
--   SOFT-deleted (db/schema/roles.ts:36-37 -> softDelete) and the
--   repository's own live-role index is `roles_tenant_live_idx ...
--   where deleted_at is null` (db/schema/roles.ts:42-44). Without the
--   filter, a tenant whose owner role is soft-deleted receives the grant
--   on the DEAD role, while a live, re-keyed owner receives nothing - the
--   same "dead with no signal" failure, on the more likely case.
--
--   THE RESIDUAL, STATED: a tenant that RE-KEYED its owner role gets no
--   grant, and its owner must grant the key explicitly - the same path a
--   manager uses, and visible in the trail. Named residual R-4.
--
-- WHO GETS IT BY DEFAULT
--   The owner template is "the whole catalogue minus attendance.mark"
--   (lib/services/roles.ts:24-26), so the new key lands on OWNER
--   automatically for every new tenant. The ADMIN template is "the
--   whole catalogue minus staff pay" (:27-29) - so without an exclusion
--   the new privilege would SILENTLY WIDEN to admin on every new tenant,
--   a widening nobody decided. The exclusion is a separate, human-gated
--   change (files/lib/services/roles.ts.txt), and the two human-owned
--   tier1 cross-checks that pin the matrix are named in the handoff.
--
-- THE FACILITY-LIMITED MANAGER IS NOT A ROLE TEMPLATE
--   The human's decision is "an OWNER, or a FACILITY-LIMITED MANAGER".
--   The manager's authority is the OWNER'S EXPLICIT GRANT on the role the
--   club calls "manager" - the same path any delegated privilege takes,
--   and visible in the trail - and the manager's facility narrowing is
--   enforced by the service against live assignment data, and RECORDED by
--   the attestation's account_binding_basis and
--   account_binding_facility_id columns (20261109100100). No "manager"
--   role template is created here and no broad grant is made.
--
-- ORDERING
--   The catalogue row is inserted FIRST in this file, because
--   role_permissions.permission_key references permissions.key: the
--   grant cannot even be WRITTEN before the catalogue carries the key.

insert into permissions (key, module, description)
values (
  'members.link.confirm',
  'members',
  'Confirm or withdraw a member''s sign-in account link when the account''s number and the club''s record differ'
)
on conflict (key) do update
  set module = excluded.module,
      description = excluded.description;

insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'members.link.confirm'
from roles r
where r.key = 'owner'
  and r.deleted_at is null
on conflict do nothing;
