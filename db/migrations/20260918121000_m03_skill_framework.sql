-- 20260918121000_m03_skill_framework
--
-- M-03 — the generic skill framework (implementation-plan.md M-03,
-- architecture.md §8.12). A framework is a named, versioned node
-- ladder scoped to one tenant and one activity type; each node carries
-- a rubric jsonb. An assessment records a member's band (1-4) against
-- one node. This is the kernel shape a second activity type can use
-- without a schema change.
--
-- ADDITIVE ONLY. The swim-shaped `skill_levels` / `skills` tables stay
-- exactly as they are: presets still seed them (applyPreset), and the
-- existing progress UI still reads them. Migrating the preset ladder
-- into the generic shape is a follow-up data migration, deliberately
-- not taken here.
--
-- Conventions match the Release 1 tables (K-01 shape):
--   * id UUIDv7 generated app-side — no gen_random_uuid() default.
--   * tenant-leading indexes; composite (id, tenant_id) keys so every
--     child FK is a real cross-tenant guard, not a bare uuid.
--   * RLS enable + force + the converged nullif tenant_isolation
--     policy; app_user gets full DML.

create table skill_frameworks (
  id               uuid not null,          -- UUIDv7, generated app-side
  tenant_id        uuid not null references tenants(id) on delete cascade,
  activity_type_key text not null references activity_types(key),
  name             text not null,
  version          integer not null default 1,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  constraint skill_frameworks_id_tenant_key unique (id, tenant_id),
  constraint skill_frameworks_name_check
    check (char_length(name) between 1 and 120),
  constraint skill_frameworks_version_check check (version > 0)
);

create unique index skill_frameworks_tenant_activity_name_version_uidx
  on skill_frameworks (tenant_id, activity_type_key, lower(name), version);

create index skill_frameworks_tenant_activity_active_idx
  on skill_frameworks (tenant_id, activity_type_key)
  where is_active;

alter table skill_frameworks enable row level security;
alter table skill_frameworks force row level security;

create policy tenant_isolation on skill_frameworks
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on skill_frameworks to app_user;

create table skill_nodes (
  id           uuid not null,              -- UUIDv7, generated app-side
  tenant_id    uuid not null references tenants(id) on delete cascade,
  framework_id uuid not null,
  parent_id    uuid,
  name         text not null,
  ordinal      integer not null,
  rubric       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint skill_nodes_id_tenant_key unique (id, tenant_id),
  constraint skill_nodes_name_check check (char_length(name) between 1 and 120),
  constraint skill_nodes_ordinal_check check (ordinal > 0),
  constraint skill_nodes_rubric_object_check
    check (jsonb_typeof(rubric) = 'object'),
  constraint skill_nodes_framework_tenant_fkey
    foreign key (framework_id, tenant_id)
    references skill_frameworks (id, tenant_id)
    on delete cascade,
  constraint skill_nodes_parent_tenant_fkey
    foreign key (parent_id, tenant_id)
    references skill_nodes (id, tenant_id)
    on delete cascade
);

create index skill_nodes_tenant_framework_ordinal_idx
  on skill_nodes (tenant_id, framework_id, ordinal);

create index skill_nodes_tenant_parent_idx
  on skill_nodes (tenant_id, parent_id);

alter table skill_nodes enable row level security;
alter table skill_nodes force row level security;

create policy tenant_isolation on skill_nodes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on skill_nodes to app_user;

create table assessments (
  id          uuid not null,               -- UUIDv7, generated app-side
  tenant_id   uuid not null references tenants(id) on delete cascade,
  member_id   uuid not null,
  node_id     uuid not null,
  band        integer not null,
  -- The assessor is a user, nullable because a job or an operator
  -- import may write historical rows without an actor.
  assessed_by uuid references users(id),
  assessed_at timestamptz not null default now(),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint assessments_band_check check (band between 1 and 4),
  constraint assessments_id_tenant_key unique (id, tenant_id),
  constraint assessments_member_tenant_fkey
    foreign key (member_id, tenant_id)
    references members (id, tenant_id)
    on delete cascade,
  constraint assessments_node_tenant_fkey
    foreign key (node_id, tenant_id)
    references skill_nodes (id, tenant_id)
    on delete cascade
);

create index assessments_tenant_member_assessed_idx
  on assessments (tenant_id, member_id, assessed_at desc);

create index assessments_tenant_node_idx
  on assessments (tenant_id, node_id);

alter table assessments enable row level security;
alter table assessments force row level security;

create policy tenant_isolation on assessments
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on assessments to app_user;
