-- platform_admin_sessions_read
--
-- Phase 1.4 (tenant detail) needs sessionsThisMonth per tenant.
-- The detail page's header query joins through the tenants table
-- with a sessions subquery for the count. The sessions table is
-- RLS-protected (FORCE), so the platform_admin policy needs a
-- companion SELECT clause on it. Same shape as the other
-- platform_admin_select policies from migration
-- 20260901162028: SELECT-only, keyed on app.platform_admin.
--
-- We add this as a separate migration rather than amending the prior
-- one because the prior migration has been applied to running
-- databases; per the standing rule never edit an applied migration.

create policy platform_admin_select on sessions
  for select
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  );
