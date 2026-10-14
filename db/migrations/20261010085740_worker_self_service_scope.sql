-- 20261010085740_worker_self_service_scope
--
-- A05 — docs/audits/2026-10-09-role-content-permission-audit.md §8.
--
-- The seeded Worker role carried `staff.roster`, the grant that gates
-- building, deleting and publishing the roster (lib/actions/shifts.ts)
-- and approving someone else's leave (lib/actions/leave.ts). A worker
-- is self-service only. lib/services/roles.ts now seeds the Worker
-- template with `staff.self` and a `/worker` home; this forward-only
-- corrective migration brings existing tenants to the same state.
--
-- Scope: SYSTEM worker roles only (key = 'worker' AND is_system = true).
-- Custom roles are never touched — not a role renamed by the tenant,
-- not a custom role that happens to carry `staff.roster`, not a custom
-- role that happens to use the 'worker' key. Only the placeholder
-- `/parent` home is repointed; a tenant-customised home_path is left
-- alone.
--
-- Idempotent: the delete removes only the single
-- (tenant, role, 'staff.roster') row and the update condition is
-- consumed by its own result. Re-running changes nothing.
--
-- Transactional: db/migrate.ts wraps every migration in one
-- transaction; harnesses that execute the file directly get the same
-- atomicity because Postgres runs a multi-statement query as one
-- implicit transaction.

delete from role_permissions rp
using roles r
where rp.role_id = r.id
  and rp.tenant_id = r.tenant_id
  and r.key = 'worker'
  and r.is_system = true
  and rp.permission_key = 'staff.roster';

update roles
set home_path = '/worker'
where key = 'worker'
  and is_system = true
  and home_path = '/parent';
