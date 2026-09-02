-- preset_engine_schema
--
-- Phase 2.2a — the schema the applyPreset engine (architecture §7.4)
-- writes to. 2.1's definitions describe features, terminology, roles,
-- programs, skill levels, plan shapes, facilities, example batches,
-- message templates and dashboard cards. The tables for *features*
-- (tenant_features, 1.8), *terminology* (tenants.terminology jsonb),
-- *roles* (lib/services/roles), *programs* (programs), and *batches*
-- (batches) already exist. This migration adds the rest:
--
--   is_sample on programs and batches
--   skill_levels, skills (with rubric jsonb)
--   plan_shapes (with amount_paise nullable — the "no seeded prices"
--     invariant from architecture §7.2)
--   facilities, facility_sub_units
--   message_templates
--   dashboard_cards on tenants (jsonb array)
--
-- RLS posture mirrors the existing tenant-scoped tables: every
-- new table gets enable + force + tenant_isolation + the platform
-- admin's read/write path through the new platform_admin policies
-- 1.5/1.6 added. None of these tables are in the platform allowlist
-- — they're tenant-scoped and need the same gating the rest of the
-- tenant tables already have.
--
-- The is_sample column is the only flag the engine ever needs to
-- read at runtime — the architecture's rule 5 ("lock after first
-- real use") resolves to "any member row exists" today since
-- members are never sample. The flag here is for the operator's
-- "remove sample data" affordance (2.3) and the audit timeline
-- (so the operator can tell seeded rows from real ones).

-- ---------------------------------------------------------------------------
-- is_sample on programs and batches
-- ---------------------------------------------------------------------------

alter table programs
  add column is_sample boolean not null default false;

alter table batches
  add column is_sample boolean not null default false;

-- ---------------------------------------------------------------------------
-- skill_levels
-- ---------------------------------------------------------------------------

create table skill_levels (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  ordinal     int not null,
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique (id, tenant_id),
  check (ordinal > 0)
);

create index skill_levels_tenant_id_idx on skill_levels (tenant_id);
create index skill_levels_tenant_ordinal_idx
  on skill_levels (tenant_id, ordinal);

alter table skill_levels enable row level security;
alter table skill_levels force row level security;

create policy tenant_isolation on skill_levels
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy platform_admin_select on skill_levels
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on skill_levels
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

-- ---------------------------------------------------------------------------
-- skills
-- ---------------------------------------------------------------------------

create table skills (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  skill_level_id  uuid not null,
  name            text not null,
  rubric          jsonb not null,
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  unique (id, tenant_id),
  foreign key (skill_level_id, tenant_id)
    references skill_levels (id, tenant_id)
    on delete cascade
);

create index skills_tenant_id_idx on skills (tenant_id);
create index skills_skill_level_id_idx on skills (skill_level_id);

alter table skills enable row level security;
alter table skills force row level security;

create policy tenant_isolation on skills
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy platform_admin_select on skills
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on skills
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

-- ---------------------------------------------------------------------------
-- plan_shapes
-- amount_paise is intentionally nullable — architecture §7.2
-- pins this: a seeded price becomes a billing dispute the day the
-- first invoice is cut. The wizard makes the field required before
-- the plan can activate (work-guide 2.6).
-- ---------------------------------------------------------------------------

create table plan_shapes (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  name           text not null,
  kind           text not null,
  duration_days  int,
  sessions       int,
  amount_paise   bigint,
  currency       text not null default 'INR',
  is_sample      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  unique (id, tenant_id),
  check (kind in ('duration', 'sessions')),
  check (
    (kind = 'duration' and duration_days is not null and sessions is null)
    or (kind = 'sessions' and sessions is not null and duration_days is null)
  )
);

create index plan_shapes_tenant_id_idx on plan_shapes (tenant_id);

alter table plan_shapes enable row level security;
alter table plan_shapes force row level security;

create policy tenant_isolation on plan_shapes
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy platform_admin_select on plan_shapes
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on plan_shapes
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

-- ---------------------------------------------------------------------------
-- facilities
-- ---------------------------------------------------------------------------

create table facilities (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  kind        text not null,
  capacity    int not null,
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique (id, tenant_id),
  check (kind in ('pool', 'court', 'turf', 'studio', 'field')),
  check ( capacity > 0)
);

create index facilities_tenant_id_idx on facilities (tenant_id);

alter table facilities enable row level security;
alter table facilities force row level security;

create policy tenant_isolation on facilities
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy platform_admin_select on facilities
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on facilities
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

-- ---------------------------------------------------------------------------
-- facility_sub_units
-- No is_sample on sub-units: sample-ness is on the parent
-- facility. Deleting the parent cascades.
-- ---------------------------------------------------------------------------

create table facility_sub_units (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  facility_id   uuid not null,
  name          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  unique (id, tenant_id),
  foreign key (facility_id, tenant_id)
    references facilities (id, tenant_id)
    on delete cascade
);

create index facility_sub_units_tenant_id_idx on facility_sub_units (tenant_id);
create index facility_sub_units_facility_id_idx on facility_sub_units (facility_id);

alter table facility_sub_units enable row level security;
alter table facility_sub_units force row level security;

create policy tenant_isolation on facility_sub_units
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy platform_admin_select on facility_sub_units
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on facility_sub_units
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

-- ---------------------------------------------------------------------------
-- message_templates
-- ---------------------------------------------------------------------------

create table message_templates (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  key           text not null,
  content       text not null,
  is_sample     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  unique (id, tenant_id),
  unique (tenant_id, key)
);

create index message_templates_tenant_id_idx on message_templates (tenant_id);

alter table message_templates enable row level security;
alter table message_templates force row level security;

create policy tenant_isolation on message_templates
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy platform_admin_select on message_templates
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on message_templates
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

-- ---------------------------------------------------------------------------
-- dashboard_cards on tenants
-- Simplest shape: a jsonb array of card keys. The operator-side
-- surface (Phase 4 navigation) reads this to decide which cards
-- show first. JSONB rather than a separate table because the
-- list is short, ordered, and a single tenant — there's no
-- analytics or cross-tenant query on it.
-- ---------------------------------------------------------------------------

alter table tenants
  add column dashboard_cards jsonb not null default '[]'::jsonb;
