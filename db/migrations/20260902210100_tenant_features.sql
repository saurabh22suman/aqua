-- tenant_features
--
-- Phase 1.8 lands the per-tenant feature override layer described in
-- architecture.md §7.1. Until now, the effective feature set was
-- plan_features only (`db/features.ts::resolveTenantFeatureKeys`).
-- This table introduces the per-tenant override: an operator can
-- enable a feature the plan doesn't carry, disable one the plan
-- does, or set a trial expiry that falls back to the plan when the
-- expiry passes.
--
-- Schema follows architecture.md §7.2 verbatim: `enabled boolean`
-- is the override direction (true = force on, false = force off);
-- `config jsonb` holds admin-tunable values the developer defined
-- (NOT a form builder — see §7.2's out-of-scope note); `expires_at
-- timestamptz` is the trial/beta window. Resolution lives in the
-- service layer (`resolveTenantFeatureKeys`), not in SQL — a
-- expired row stays in the table, the resolver falls back to the
-- plan, the audit timeline (platform_audit_log) records when the
-- override was applied and when it'll fall back.
--
-- RLS posture mirrors `tenants` and `plan_features`:
--   - `tenant_isolation` already exists for tenant users under
--     withTenant (no need to add it again — same FORCE RLS, same
--     USING/WITH CHECK on tenant_id).
--   - `platform_admin_*` family of policies: this migration opens
--     INSERT/UPDATE/DELETE on `tenant_features` for the
--     withPlatformAdmin() path, mirroring the 1.5 platform_admin_insert
--     and 1.6 platform_admin_update policies.
--
-- The (tenant_id, feature_key) primary key matches architecture.md's
-- spec verbatim — one row per (tenant, feature), with config and
-- expires_at overwrites updating the same row rather than appending.

create table tenant_features (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  feature_key text not null references features(key) on delete cascade,
  enabled     boolean not null,
  config      jsonb not null default '{}'::jsonb,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

create index tenant_features_feature_key_idx
  on tenant_features (feature_key);

create index tenant_features_expires_at_idx
  on tenant_features (expires_at)
  where expires_at is not null;

alter table tenant_features enable row level security;
alter table tenant_features force row level security;

-- Standard tenant-isolation: the row is visible iff its tenant_id
-- matches the session variable. Combined with app_user's full grant
-- on platform-scope reads, this is what allows the tenant user to
-- read its own overrides under withTenant() and prevents cross-tenant
-- reads.
create policy tenant_isolation on tenant_features
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Platform-side write path. The operator's per-tenant toggle runs
-- under withPlatformAdmin() (same shape as the existing 1.5/1.6
-- platform_admin_insert/update policies). Multiple permissive
-- policies OR — a tenant user with app.tenant_id set can still
-- touch only its own row (tenant_isolation), and a platform_admin
-- scope can touch any tenant's row (this policy). Defense in
-- depth: an accidental unrestricted scope would still be denied
-- because no policy matches.
create policy platform_admin_all on tenant_features
  for all
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  )
  with check (
    current_setting('app.platform_admin', true) = 'true'
  );

-- GRANTs: app_user retains the full table-level CRUD grant from
-- bootstrap-roles.ts. The RLS policies above gate by scope
-- (tenant_id session variable vs platform_admin session variable);
-- the GRANTs alone are not a permission bypass. Revoking INSERT
-- would break the withPlatformAdmin() path too — the GRANTs are
-- necessary even though the policies do the gating.
