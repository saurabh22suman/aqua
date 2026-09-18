-- 20260918051000_h02_rls_policy_convergence
--
-- H-02 (Release 1 hardening) — one RLS policy shape across tenant
-- tables. Migration 0004_policy_nullif_hardening.sql standardised the
-- `nullif(current_setting('app.tenant_id', true), '')::uuid` form on
-- the core tables; this migration converges every tenant-isolation
-- policy that still predates it.
--
-- Two legacy shapes were found by grepping the migrations and by
-- reading pg_policies on a fully-migrated database:
--
--   1. `(tenant_id)::text = current_setting('app.tenant_id', true)`
--      — the eight the H-02 audit named: staff_locations,
--      location_presets, makeup_credits, tenant_holidays,
--      waitlist_entries, member_facility_optins, invite_link_uses,
--      absence_alerts.
--   2. `tenant_id = current_setting('app.tenant_id', true)::uuid`
--      — seven more the H-02 test surfaced once it asserted *every*
--      app.tenant_id policy: facilities, facility_sub_units,
--      message_templates, plan_shapes, skill_levels, skills,
--      tenant_features. Included because H-02's contract is "one
--      policy shape" and the test reads all fourteen plus tenants.
--
-- Both legacy shapes error on an empty/unset GUC (`''::uuid`); the
-- nullif form returns NULL, so an unscoped read returns zero rows —
-- the documented contract. Only tenant_isolation policies are
-- touched: platform_admin_select/write, user_resolution and the
-- special-cased config_values policy stay exactly as they are.

-- 1. The eight the audit named (text-shaped).
drop policy staff_locations_tenant_isolation on staff_locations;
create policy staff_locations_tenant_isolation on staff_locations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy location_presets_tenant_isolation on location_presets;
create policy location_presets_tenant_isolation on location_presets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy makeup_credits_tenant_isolation on makeup_credits;
create policy makeup_credits_tenant_isolation on makeup_credits
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy tenant_holidays_tenant_isolation on tenant_holidays;
create policy tenant_holidays_tenant_isolation on tenant_holidays
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy waitlist_entries_tenant_isolation on waitlist_entries;
create policy waitlist_entries_tenant_isolation on waitlist_entries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy member_facility_optins_tenant_isolation on member_facility_optins;
create policy member_facility_optins_tenant_isolation on member_facility_optins
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy invite_link_uses_tenant_isolation on invite_link_uses;
create policy invite_link_uses_tenant_isolation on invite_link_uses
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy absence_alerts_tenant_isolation on absence_alerts;
create policy absence_alerts_tenant_isolation on absence_alerts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- 2. The seven the test surfaced (current_setting(...)::uuid form).
drop policy tenant_isolation on facilities;
create policy tenant_isolation on facilities
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy tenant_isolation on facility_sub_units;
create policy tenant_isolation on facility_sub_units
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy tenant_isolation on message_templates;
create policy tenant_isolation on message_templates
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy tenant_isolation on plan_shapes;
create policy tenant_isolation on plan_shapes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy tenant_isolation on skill_levels;
create policy tenant_isolation on skill_levels
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy tenant_isolation on skills;
create policy tenant_isolation on skills
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy tenant_isolation on tenant_features;
create policy tenant_isolation on tenant_features
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
