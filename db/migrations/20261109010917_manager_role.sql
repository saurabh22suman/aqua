-- manager_role
-- PROPOSED — NOT APPLIED. NOT RUN. NOT COMPILED. NOT TESTED.
--
-- The coordinator generates the timestamped file with
--   pnpm db:new-migration manager_role
-- and copies this body verbatim. NEVER edit an applied migration.
--
-- WHAT IT DOES
--   1. Checks that the 24 canonical permission keys exist in the
--      `permissions` catalogue and refuses to run if any is missing.
--      No catalogue row is added: all 24 keys are already in
--      db/seed-platform.ts PERMISSIONS, and the database has them
--      because db/migrations/20260918000000_reference_catalogue.sql
--      seeds the catalogue (with 20260919222900_v24_staff_self_permission.sql
--      and 20260921173406_payments_refund_permission.sql adding the two
--      later keys). `permissions.module` carries no foreign key, so the
--      catalogue is not touched here.
--   2. Creates ONE `manager` role per existing tenant, ONLY where the
--      tenant has no role with that key, with the template's home route
--      and priority (/owner, ordinal 1).
--   3. Grants exactly the 24 canonical keys to the roles IT CREATED —
--      and to nothing else. No other role, in any tenant, is read or
--      written.
--
-- THE COLLISION GUARD
-- A tenant that already has a role with the key 'manager' is a
-- COLLISION: that role is the tenant's own — a custom role, or one an
-- operator created by hand. The migration ABORTS instead of overwriting
-- it, renaming it, or seizing its grants. The tenant's role and its
-- grants stay exactly as they are, and the operator resolves that
-- tenant by hand. The guard runs BEFORE any insert, so a collision
-- leaves the database untouched.
--
-- WHY is_system IS TRUE
-- The role is seeded from a template, exactly like the other seeded
-- roles (lib/services/roles.ts seedRoleTemplates), so is_system is true.
-- This rollout does not touch the tenant's existing roles, and it does
-- not touch the owner, administrator, accountant, receptionist, coach,
-- curriculum-lead or worker templates.
--
-- FUTURE TENANTS
-- A tenant created after this migration gets its manager role from the
-- TEMPLATE (lib/services/roles.ts ROLE_TEMPLATES → seedRoleTemplates),
-- not from this SQL. The template and this migration carry the same 24
-- keys; the preset contract test pins them against each other by name.
--
-- NO new columns, NO new database-role privilege grants, NO catalogue row, NO schema file.

-- ── 1. THE CATALOGUE MUST ALREADY CARRY THE 24 KEYS ───────────────────
--
-- role_permissions.permission_key references permissions(key), so a
-- missing catalogue row would fail the whole rollout with a bare FK
-- error. This check names the missing keys instead.
do $manager_rollout_catalogue$
declare
  v_missing text;
begin
  select string_agg(k.key, ', ' order by k.key)
    into v_missing
  from unnest(array[
    'members.read',
    'members.read.assigned',
    'members.write',
      'members.link.confirm',
    'attendance.read',
    'programs.read',
    'enquiries.read',
    'enquiries.write',
    'invoices.read',
    'payments.read',
    'bookings.read',
    'bookings.write',
    'reports.operational',
    'staff.self',
    'levels.read',
    'levels.assess',
    'payments.record',
    'payments.refund',
    'invoices.write',
    'reports.financial',
    'dashboard.view',
    'staff.read',
    'staff.attendance',
    'staff.roster'
  ]) as k(key)
  where not exists (select 1 from permissions p where p.key = k.key);

  if v_missing is not null then
    raise exception
      'manager role rollout: these permission keys are missing from the catalogue: %',
      v_missing;
  end if;
end
$manager_rollout_catalogue$;

-- ── 2 + 3. THE ROLE, THEN EXACTLY ITS 24 GRANTS ───────────────────────
--
-- gen_random_uuid() is v4, not the app-side uuidv7 — the accepted
-- exception from migration 0010: migrations are plain SQL and have no
-- uuidv7.
do $manager_rollout$
declare
  v_tenant uuid;
  v_existing uuid;
  v_role uuid;
  v_created uuid;
  v_key text;
begin
  -- THE COLLISION GUARD, BEFORE ANY INSERT.
  for v_tenant in select t.id from tenants t loop
    select r.id into v_existing
      from roles r
     where r.tenant_id = v_tenant
       and r.key = 'manager'
     limit 1;
    if v_existing is not null then
      raise exception
        'manager role rollout: tenant % already has a role with the key ''manager'' (role id %). Refusing to overwrite it or to seize its grants — resolve that tenant by hand, then re-run.',
        v_tenant,
        v_existing;
    end if;
  end loop;

  for v_tenant in select t.id from tenants t loop
    v_role := gen_random_uuid();

    insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal)
    values (v_role, v_tenant, 'manager', 'Facility Manager', true, '/owner', 1)
    on conflict (tenant_id, key) do nothing;

    -- The row that exists now must be the row THIS migration created.
    -- If it is not, another writer created it in between, and this
    -- migration must not grant to a role it did not create.
    select r.id into v_created
      from roles r
     where r.tenant_id = v_tenant
       and r.key = 'manager';
    if v_created is distinct from v_role then
      raise exception
        'manager role rollout: the manager role for tenant % appeared concurrently (role id %) — refusing to grant to a role this migration did not create.',
        v_tenant,
        v_created;
    end if;

    -- THE 24 CANONICAL GRANTS, FOR THE ROLE THIS MIGRATION CREATED.
    foreach v_key in array array[
      'members.read',
      'members.read.assigned',
      'members.write',
      'members.link.confirm',
      'attendance.read',
      'programs.read',
      'enquiries.read',
      'enquiries.write',
      'invoices.read',
      'payments.read',
      'bookings.read',
      'bookings.write',
      'reports.operational',
      'staff.self',
      'levels.read',
      'levels.assess',
      'payments.record',
      'payments.refund',
      'invoices.write',
      'reports.financial',
      'dashboard.view',
      'staff.read',
      'staff.attendance',
      'staff.roster'
    ] loop
      insert into role_permissions (tenant_id, role_id, permission_key)
      values (v_tenant, v_role, v_key)
      on conflict do nothing;
    end loop;
  end loop;
end
$manager_rollout$;
