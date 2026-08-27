-- Pre-tenant resolution (F-06 follow-up): better-auth establishes WHO a
-- request is before WHICH tenant it belongs to is known, so the queries
-- that map identity -> tenant/membership/role cannot run inside
-- withTenant(). They previously ran on a superuser connection
-- (MIGRATION_DATABASE_URL) that bypasses RLS unconditionally, trusting
-- hand-written WHERE clauses as the only defense. This migration replaces
-- that with a second, permissive RLS policy keyed on app.user_id, so the
-- same mechanical guarantee withTenant() gives tenant-scoped code also
-- covers pre-tenant resolution.
--
-- Permissive policies OR together in Postgres, so this widens visibility
-- only for sessions that call withUser() (db/tenant.ts) and set
-- app.user_id; ordinary withTenant() sessions never set it, so this policy
-- always evaluates false for them and contributes nothing.
--
-- FOR SELECT ONLY — load-bearing, not a style choice. A `for all` policy
-- here would default to also governing INSERT/UPDATE, and its WITH CHECK
-- would only be able to constrain user_id (there is no tenant to check
-- against yet). That would let an authenticated user INSERT a
-- tenant_memberships row for themselves against ANY tenant_id — a
-- self-granted membership into a tenant they were never invited to. Writes
-- must stay exclusively under the existing tenant-scoped policy, reached
-- only through withTenant(). Do not widen this to `for all` or add a
-- WITH CHECK clause without re-deriving why that escalation can't happen.

create policy user_resolution on tenant_memberships
  for select
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- A tenant is visible under user-scoped resolution only if the current
-- user holds some membership in it — exactly what slug resolution needs
-- (confirm the requested slug belongs to a tenant this user can reach),
-- nothing more.
create policy user_resolution on tenants
  for select
  using (id in (
    select tenant_id from tenant_memberships
    where user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));

-- Narrowed to the user's OWN role, not every role in a tenant they belong
-- to: resolution only ever joins roles via tenant_memberships.role_id for
-- the current user's membership row (db/platform.ts). A screen that needs
-- a tenant's full role list runs inside withTenant() and does not need
-- this policy at all — broaden it only if a real caller needs more, and
-- name that caller here when it happens.
create policy user_resolution on roles
  for select
  using (id in (
    select role_id from tenant_memberships
    where user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));
