-- platform_admin_tenant_read
--
-- Phase 1.3 surfaces the operator's tenant list, which requires
-- cross-tenant aggregation. The existing tenant_isolation policy is
-- intentionally strict — forgetting app.tenant_id fails closed (zero
-- rows, not an error). A separate, SELECT-only policy keyed on a
-- platform-admin session variable grants withPlatformAdmin() reads
-- without weakening the default-deny for any inadvertently unscoped
-- caller.
--
-- Multiple SELECT policies OR together — a tenant scope with
-- app.tenant_id set sees its own row; withPlatformAdmin() sees every
-- row. Writes remain gated by the original tenant_isolation policy;
-- this new policy is for SELECT only.

-- tenants
create policy platform_admin_select on tenants
  for select
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  );

-- tenants.preset_key references presets.key — the platform admin must
-- see preset definitions. presets is already RLS-exempt (allowlist),
-- so the join resolves naturally; no extra policy needed there.

-- tenant_memberships — needed by later phases when the operator
-- drills into a tenant. Adding the SELECT-only policy now while the
-- migration is small.
create policy platform_admin_select on tenant_memberships
  for select
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  );

-- locations — for the per-tenant location count in the tenant list.
create policy platform_admin_select on locations
  for select
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  );

-- members — for the per-tenant member count.
create policy platform_admin_select on members
  for select
  to app_user
  using (
    current_setting('app.platform_admin', true) = 'true'
  );

-- Same for plans — already RLS-exempt (allowlist), but the policy is
-- a no-op there, kept here as documentation that the platform scope
-- sees plans. No new policy needed.
