-- 20260919223022_v23_staff_self_backfill
--
-- V-23/V-24 — role_permissions backfill for the new `staff.self`
-- permission.
--
-- Self-service staff actions (own roster, own check-in/out, own leave
-- requests) are mutations by a staff member on their own record. They
-- are gated by `staff.self` rather than by `staff.attendance` (which
-- marks OTHER people's attendance) or `staff.roster` (which builds the
-- roster), so the action scanners keep a real permission key to check
-- and a coach can never mark a colleague.
--
-- lib/services/roles.ts now seeds staff.self for owner/admin (via the
-- full key list) and explicitly for accountant, receptionist, coach and
-- worker. Existing tenants were seeded before this key existed, so
-- their role_permissions rows lack it. Without this backfill a coach
-- opening /coach/me gets ForbiddenError on their own check-in.
--
-- Idempotent: `on conflict do nothing`. Matches by role.key (the
-- stable seeded key), so a tenant that renamed a role keeps whatever
-- its customised role carries. Forward-only; the down migration would
-- be a delete on the same predicate.

insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'staff.self'
from roles r
where r.key in ('owner', 'admin', 'accountant', 'coach', 'receptionist', 'worker')
on conflict do nothing;
