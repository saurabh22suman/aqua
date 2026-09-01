-- platform_admin_tenant_update
--
-- Phase 1.6 introduces the platform-side status transition path: an
-- operator suspends, reactivates or churns a tenant. The status is
-- the only column the platform surface writes on tenants in this
-- phase (1.8 will add per-tenant feature toggle overrides, and
-- follow-on phases will add more write columns; none of those
-- change this migration). Migration 20260902200000
-- (platform_admin_insert) opened the INSERT path; this one opens
-- the UPDATE path the same way.
--
-- platform_admin_update is `for update`, gated on
-- current_setting('app.platform_admin', true) = 'true'. Combine
-- with the existing tenant_isolation (for all) on tenants: both
-- policies apply to UPDATE, Postgres OR-combines them. Tenant
-- self-update remains gated by tenant_isolation — a tenant user
-- who somehow opens an UPDATE form can still only touch their own
-- row, and is no closer to changing their own status than before
-- (no UI exposes status to a tenant user anyway). The platform
-- surface reaches every tenant's status column through
-- withPlatformAdmin().
--
-- Why no `update_columns` / column-level grant: GRANTs already
-- restrict app_user's column privileges (db/bootstrap-roles.ts).
-- RLS policies gate rows, not columns; that split is intentional,
-- `db/CLAUDE.md` and `docs/architecture.md` §5.6 explain why. If
-- a future tenant-side surface needs status editing, add a
-- tenant-visible column grant then — not before.

create policy platform_admin_update on tenants
  for update
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  )
  with check (
    current_setting('app.platform_admin', true) = 'true'
  );
