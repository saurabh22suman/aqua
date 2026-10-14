-- 20261013181215_owner_admin_attendance_read_only
--
-- 2026-10-13 role-workflow audit R01 — student attendance is execution
-- work: the coach who ran the session marks it, reception provides
-- location-scoped backup, and Owner/Admin keep completion/status
-- reporting and read-only register access. The seeded owner/admin
-- templates carried `attendance.mark` through the full catalogue
-- (lib/services/roles.ts); this forward-only corrective migration
-- removes the persisted grant from existing tenants.
--
-- Scope: SYSTEM owner/admin roles only (key IN ('owner','admin') AND
-- is_system = true). A tenant-renamed role keeps its name; a custom
-- role is never touched. The action/service layer independently
-- refuses owner/admin contexts, so this migration is the persisted
-- state, not the only guard.
--
-- Idempotent: deleting an already-absent row changes nothing.

delete from role_permissions rp
using roles r
where rp.role_id = r.id
  and rp.tenant_id = r.tenant_id
  and r.key in ('owner', 'admin')
  and r.is_system = true
  and rp.permission_key = 'attendance.mark';
