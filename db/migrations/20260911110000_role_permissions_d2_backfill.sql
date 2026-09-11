-- D2 follow-up: role_permissions backfill for the audit fix.
--
-- PR D2 (lib/auth/surface-guard.ts + requirePermission on every
-- 'use server' function) introduced two new permissions:
--   * dashboard.view       — owner + admin only; gates getOwnerDashboardAction.
--   * members.read.assigned — coach only; gates getCoachRosterAction /
--                            getCoachMemberDetailAction.
--
-- PR D2 also split members.read: coach no longer holds it (the coach
-- row in ROLE_TEMPLATES in lib/services/roles.ts dropped it; coach
-- now uses members.read.assigned). Coach previously held members.read
-- legitimately for their own roster — the audit demonstrated that
-- check is insufficient because a coach could Next-Action POST
-- listMembersAction and get the tenant's full member list. With
-- coach now holding members.read.assigned only, listMembersAction
-- requires the full members.read (which coach no longer has) and
-- the direct-POST leak is closed.
--
-- Existing tenants were seeded before this split. Their role_permissions
-- rows carry the old shape:
--   * coach rows have members.read, no members.read.assigned
--   * owner + admin rows are missing dashboard.view
--   * receptionist rows are correct already (members.read stays)
--
-- Without this migration, #124 alone leaves existing tenants broken:
--   * dashboard breaks: getOwnerDashboardAction throws ForbiddenError
--     because dashboard.view is missing from owner/admin role_permissions.
--   * coach roster breaks: getCoachRosterAction throws ForbiddenError
--     because members.read.assigned is missing from coach role_permissions.
--   * the direct-POST leak stays open: coach still has members.read and
--     listMembersAction accepts it.
--
-- The migration:
--   1. Grants dashboard.view to every owner + admin role in every tenant
--      that doesn't already have it. Idempotent (on conflict do nothing).
--   2. Grants members.read.assigned to every coach role in every tenant
--      that doesn't already have it. Idempotent.
--   3. Revokes members.read from every coach role in every tenant
--      that has it. Idempotent — re-running is a no-op.
--
-- Preserves per-tenant customisations: the queries target role_permissions
-- rows by (role_id, permission_key); a tenant with a renamed or
-- re-keyed role is unaffected because we match by role.id (which is
-- stable), not by role.key.
--
-- The down migration (NOT shipped — forward-only per CLAUDE.md "Never
-- edit an applied migration") would simply reverse each grant /
-- revoke. If a future migration wants to add new permissions and
-- forget the backfill, this migration is the template — copy the
-- "insert into role_permissions ... on conflict do nothing" shape.

-- 1. dashboard.view to owner + admin (idempotent).
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'dashboard.view'
from roles r
where r.key in ('owner', 'admin')
on conflict do nothing;

-- 2. members.read.assigned to coach (idempotent).
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'members.read.assigned'
from roles r
where r.key = 'coach'
on conflict do nothing;

-- 3. Revoke members.read from coach (the audit-leak fix).
delete from role_permissions rp
using roles r
where rp.role_id = r.id
  and r.key = 'coach'
  and rp.permission_key = 'members.read';