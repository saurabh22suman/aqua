-- 20260918122000_m04_module_registry
--
-- M-04 — the module registry (implementation-plan.md M-04,
-- architecture.md §8.12). A module is the unit a vertical ships as:
-- preset data, config/feature keys, capabilities, and a version.
-- `modules` is the platform catalogue (closed, code-seeded, read-only
-- to the app role); `tenant_modules` records which tenants have a
-- module enabled, at which version, and when.
--
-- The registry is seeded here AND in db/seed-platform.ts for the same
-- reason as M-01's activity_types: `pnpm db:deploy` never runs the
-- seed script, so a fresh production database needs the rows from the
-- migration. Seeding is `on conflict do nothing` — re-deploying never
-- clobbers an operator's registry edits.
--
-- Capabilities use the same five flags as activity_types
-- (bookable | attendance | progress | resource_based | pos); they gate
-- UI, never data integrity.

create table modules (
  key          text primary key,
  name         text not null,
  version      integer not null default 1,
  status       text not null default 'ga'
               check (status in ('ga', 'beta', 'internal', 'retired')),
  capabilities jsonb not null default '{}'::jsonb,
  preset_keys  text[] not null default '{}',
  config_keys  text[] not null default '{}',
  feature_keys text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint modules_version_check check (version > 0),
  constraint modules_capabilities_object_check
    check (jsonb_typeof(capabilities) = 'object')
);

insert into modules
  (key, name, version, status, capabilities, preset_keys, config_keys, feature_keys)
values
  ('swimming', 'Swimming', 1, 'ga',
   '{"bookable":true,"attendance":true,"progress":true,"resource_based":true,"pos":false}'::jsonb,
   '{swimming}',
   '{billing.gst_rate_bp}',
   '{members,attendance,pool.booking,swim.levels}'),
  ('cafe', 'Café', 1, 'beta',
   '{"bookable":false,"attendance":false,"progress":false,"resource_based":false,"pos":true}'::jsonb,
   '{}',
   '{billing.gst_rate_bp,billing.sac_code}',
   '{cafe.pos}')
on conflict (key) do nothing;

create table tenant_modules (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  module_key text not null references modules(key),
  version    integer not null,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references users(id),
  primary key (tenant_id, module_key),
  constraint tenant_modules_version_check check (version > 0)
);

alter table tenant_modules enable row level security;
alter table tenant_modules force row level security;

create policy tenant_isolation on tenant_modules
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on tenant_modules to app_user;

-- Platform catalogue: read-only for the app role, writes stay on the
-- operator/migration path.
revoke all on modules from app_user;
grant select on modules to app_user;
