-- 20261013181216_curriculum_lead_levels_write
--
-- 2026-10-13 role-workflow audit R02 — curriculum maintenance is a
-- delegated duty. Adds the `levels.write` permission and a system
-- Curriculum Lead role (coach surface, coach-level trust ordinal) to
-- every existing tenant. Ordinary coaches keep levels.read/assess and
-- do NOT receive levels.write.
--
-- ORDER MATTERS: `permissions` is the FK target for
-- role_permissions.permission_key, so the permission row comes first
-- (same rule as 20260919222900_v23_staff_self_permission.sql). On a
-- fresh database the role insert still runs; tenants created through
-- the app seed roles via lib/services/roles.ts instead.
--
-- Idempotent: every insert uses on conflict do nothing.

insert into permissions (key, module, description)
values ('levels.write', 'swim.levels', 'Maintain the academy curriculum framework and rubrics')
on conflict (key) do nothing;

-- Owner/admin templates include every permission except their
-- documented exclusions, so existing tenants need the new key too.
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'levels.write'
from roles r
where r.key in ('owner', 'admin')
  and r.is_system = true
on conflict do nothing;

-- One system Curriculum Lead role per tenant (gen_random_uuid is v4,
-- not the app-side uuidv7 — the accepted exception from migration
-- 0010: migrations are plain SQL and have no uuidv7).
insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal)
select gen_random_uuid(), t.id, 'curriculum_lead', 'Curriculum Lead', true, '/coach', 2
from tenants t
on conflict (tenant_id, key) do nothing;

-- Coach-shaped grants plus the curriculum capability. Kept in sync
-- with COACH_PERMISSION_KEYS + levels.write in lib/services/roles.ts.
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, k.key
from roles r
cross join (values
  ('attendance.read'),
  ('attendance.mark'),
  ('members.read.assigned'),
  ('programs.read'),
  ('levels.read'),
  ('levels.assess'),
  ('levels.write'),
  ('staff.self')
) as k(key)
where r.key = 'curriculum_lead'
  and r.is_system = true
on conflict do nothing;
