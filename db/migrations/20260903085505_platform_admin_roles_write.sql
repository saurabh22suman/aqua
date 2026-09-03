-- platform_admin_roles_write
--
-- C1 — createTenant() (db/platform-tenant-create.ts) never seeded role
-- templates, unlike scripts/seed.ts and scripts/seed-demo.ts, both of
-- which call seedRoleTemplates right after creating the tenant row.
-- Every tenant created through the platform UI had no owner/admin/
-- receptionist/coach/accountant/worker roles at all — invite-owner
-- (db/tenant-invite.ts) fails outright for them ("This tenant has no
-- 'owner' role").
--
-- Fixing this means running seedRoleTemplates on the SAME transaction
-- as the tenant/location insert (single-transaction atomicity is the
-- explicit design of createTenant — see its own comment). That
-- transaction runs under withPlatformAdmin(), which sets
-- app.platform_admin = 'true' but not app.tenant_id — roles and
-- role_permissions are RLS'd on tenant_isolation alone (migration
-- 0009), which requires app.tenant_id to already equal the row's
-- tenant_id. Same chicken-and-egg problem
-- 20260902200000_platform_admin_tenant_write.sql solved for
-- tenants/locations; this migration extends that exact pattern to the
-- two tables seedRoleTemplates writes.
--
-- INSERT only, same as the tenants/locations policies — updates and
-- deletes to roles remain gated by tenant_isolation alone.

create policy platform_admin_insert on roles
  for insert
  to app_user
  with check (
    current_setting('app.platform_admin', true) = 'true'
  );

create policy platform_admin_insert on role_permissions
  for insert
  to app_user
  with check (
    current_setting('app.platform_admin', true) = 'true'
  );

-- roles also needs a SELECT policy: seedRoleTemplatesOnTx does
-- `.insert(roles).returning({id: roles.id})` to get the new role's id
-- for the role_permissions insert that follows, and Postgres requires
-- the just-inserted row to be visible under a SELECT policy for
-- RETURNING to work, not just WITH CHECK to pass on the insert.
-- tenants already has this (20260901162028_platform_admin_tenant_read
-- .sql) — that's why its own `.returning()` call works and roles'
-- didn't. role_permissions doesn't need one: its insert is a raw
-- `execute()` with no RETURNING.
create policy platform_admin_select on roles
  for select
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  );
