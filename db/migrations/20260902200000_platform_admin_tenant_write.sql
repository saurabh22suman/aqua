-- platform_admin_tenant_write
--
-- Phase 1.5 introduces the platform-side tenant write path: a platform
-- admin (authenticated via platform_users + mandatory 2FA, separate from
-- tenant login) creates a tenant and its first location. The existing
-- tenant_isolation policy on tenants/locations is correctly strict —
-- its WITH CHECK requires app.tenant_id to already match the row's id,
-- which is chicken-and-egg on INSERT (the row being created doesn't
-- exist yet). That policy is the right target for tenant self-
-- management; platform-side INSERT is a separate, audited surface and
-- needs its own policy.
--
-- This migration mirrors the platform_admin_select pattern from
-- 20260901162028_platform_admin_tenant_read.sql: a per-table INSERT
-- policy gated on the transaction-scoped app.platform_admin session
-- variable. App_user without that variable still cannot INSERT through
-- this path — the new policy is additive to tenant_isolation, not a
-- replacement. Both apply on INSERT; Postgres OR-combines permissive
-- policies (>=1 must pass), so an INSERT under withPlatformAdmin()
-- passes via platform_admin_insert while tenant_isolation's WITH CHECK
-- (id = app.tenant_id) still fails safely (app.tenant_id is unset).
--
-- Why this and not the MIGRATION_DATABASE_URL superuser: architecture.md
-- §5.6 bans that pool from any path a live request can reach ("no
-- exception, anywhere, for any reason"). The platform service layer has
-- no superuser connection available — this policy is the only path the
-- create-tenant UI can use to actually write tenant data.
--
-- UPDATE / DELETE on tenant tables remain gated by tenant_isolation
-- alone. Phase 1.6 (status lifecycle) will introduce a separate
-- platform_admin_update policy when it actually needs it — not before.

-- tenants: the tenant row itself
create policy platform_admin_insert on tenants
  for insert
  to app_user
  with check (
    current_setting('app.platform_admin', true) = 'true'
  );

-- locations: the first location row that belongs to the new tenant
create policy platform_admin_insert on locations
  for insert
  to app_user
  with check (
    current_setting('app.platform_admin', true) = 'true'
  );

-- The existing tenant_isolation.with check on locations
-- (tenant_id = app.tenant_id::uuid) still applies alongside this one;
-- the new policy is the additional permissive path. The platform_admin
-- session variable is set by withPlatformAdmin() transaction-scoped and
-- unset elsewhere — the policy fails closed for any non-platform write
-- attempt by design.
