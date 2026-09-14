-- O-04 (docs/ops-platform-design.md §2–§3) — the configuration registry.
--
-- config_keys is the platform-owned catalogue, seeded and versioned in
-- code (db/config-definitions.ts) and re-asserted by db/seed-platform.ts.
-- config_values is append-only: a write supersedes the current live row
-- for its (key, scope, scope_id) and inserts the new one, so history and
-- provenance come for free.
--
-- tenant_id is denormalised onto a value row so RLS can scope it:
-- platform/plan/preset-scope rows carry null and are readable by every
-- tenant (they are the defaults); tenant/location-scope rows carry the
-- owning tenant and are visible only to it.
--
-- scope_id is text, not uuid: plan/tenant/location scopes store a uuid
-- string, preset scope stores '<key>@<version>' because preset keys are
-- text.

create table config_keys (
  key           text primary key,
  value_schema  jsonb not null,
  default_value jsonb not null,
  visibility    text not null
                check (visibility in ('owner_edit', 'owner_read', 'ops_only')),
  risk          text not null
                check (risk in ('safe', 'sensitive', 'dangerous')),
  description   text not null,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table config_values (
  id            uuid primary key default gen_random_uuid(),
  key           text not null references config_keys(key),
  scope_type    text not null
                check (scope_type in ('platform', 'plan', 'preset', 'tenant', 'location')),
  scope_id      text,
  tenant_id     uuid references tenants(id) on delete cascade,
  value         jsonb not null,
  set_by        uuid,
  set_at        timestamptz not null default now(),
  reason        text,
  superseded_at timestamptz
);

create index config_values_live_idx
  on config_values (key, scope_type, scope_id)
  where superseded_at is null;

-- One live value per (key, scope). coalesce() collapses the nullable
-- scope_id/tenant_id of platform/plan/preset rows so the uniqueness is
-- real for them too; without it Postgres treats NULLs as distinct and
-- two live platform rows would be allowed.
create unique index config_values_live_uidx
  on config_values (
    key,
    scope_type,
    coalesce(scope_id, ''),
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where superseded_at is null;

alter table config_values enable row level security;
alter table config_values force row level security;

-- nullif shape per 0004_policy_nullif_hardening: a platform-admin
-- transaction has app.tenant_id set to empty string, and a bare
-- ''::uuid cast raises before the OR can short-circuit.
create policy tenant_isolation on config_values
  using (
    tenant_id is null
    or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on config_values
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on config_values
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on config_values to app_user;

-- Backfill the one scalar key that existed as a column, then drop the
-- column. The catalogue row is bootstrapped here rather than left to
-- the seed because the FK requires it before the backfill runs;
-- db/seed-platform.ts re-asserts the code version idempotently.
insert into config_keys (key, value_schema, default_value, visibility, risk, description)
values (
  'attendance.absence_alert_threshold_pct',
  '{"type":"integer","minimum":0,"maximum":100}'::jsonb,
  '50'::jsonb,
  'owner_edit',
  'safe',
  'The share of a member''s recorded marks that can be absences before the monthly low-attendance alert fires. 0-100.'
)
on conflict (key) do nothing;

insert into config_values (key, scope_type, scope_id, tenant_id, value, set_at)
select 'attendance.absence_alert_threshold_pct',
       'tenant',
       t.id::text,
       t.id,
       to_jsonb(t.absence_alert_threshold_pct),
       now()
  from tenants t
 where t.absence_alert_threshold_pct <> 50;

alter table tenants drop column absence_alert_threshold_pct;
