-- 20260918120000_m01_activity_types
--
-- M-01 — the platform activity-type catalogue (implementation-plan.md
-- M-01, architecture.md §8.12). An activity type is the kernel's word
-- for "what kind of thing is this venue/offering": swimming, tennis,
-- fitness, team sport, café. It carries capability flags
-- (bookable | attendance | progress | resource_based | pos) that gate
-- UI, never data integrity — no table below branches on the type.
--
-- The catalogue is seeded HERE, not only in db/seed-platform.ts,
-- because the backfill of facilities.activity_type_key below needs the
-- FK target rows to exist during `pnpm db:deploy` (which never runs
-- the seed script). seedPlatformCatalogue() re-asserts the same rows so
-- the test path agrees.
--
-- M-02 is deliberately deferred: `facilities` keeps its name and its
-- `kind` column. This migration only adds one nullable, additive
-- column plus the FK and the by-kind backfill.
--   pool   -> swimming
--   court  -> tennis
--   turf   -> team_sport
--   studio -> fitness
--   field / counter / table -> NULL (no kernel type maps; left unknown
--   on purpose rather than guessed)

create table activity_types (
  key          text primary key,
  name         text not null,
  capabilities jsonb not null default '{}'::jsonb,
  sort_order   integer not null default 0,
  status       text not null default 'active'
               check (status in ('active', 'deprecated')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint activity_types_capabilities_object_check
    check (jsonb_typeof(capabilities) = 'object')
);

insert into activity_types (key, name, capabilities, sort_order, status) values
  ('swimming', 'Swimming',
   '{"bookable":true,"attendance":true,"progress":true,"resource_based":true,"pos":false}'::jsonb,
   1, 'active'),
  ('tennis', 'Tennis',
   '{"bookable":true,"attendance":true,"progress":true,"resource_based":true,"pos":false}'::jsonb,
   2, 'active'),
  ('fitness', 'Fitness',
   '{"bookable":true,"attendance":true,"progress":true,"resource_based":false,"pos":false}'::jsonb,
   3, 'active'),
  ('team_sport', 'Team sport',
   '{"bookable":false,"attendance":true,"progress":true,"resource_based":true,"pos":false}'::jsonb,
   4, 'active'),
  ('cafe', 'Café',
   '{"bookable":false,"attendance":false,"progress":false,"resource_based":false,"pos":true}'::jsonb,
   5, 'active')
on conflict (key) do nothing;

alter table facilities add column activity_type_key text;

alter table facilities
  add constraint facilities_activity_type_key_fkey
  foreign key (activity_type_key) references activity_types(key);

-- By-kind backfill. Only kinds with a kernel type map are touched;
-- everything else stays NULL (the column is display/grouping metadata,
-- not a required classification).
update facilities
   set activity_type_key = case kind
     when 'pool'   then 'swimming'
     when 'court'  then 'tennis'
     when 'turf'   then 'team_sport'
     when 'studio' then 'fitness'
   end
 where kind in ('pool', 'court', 'turf', 'studio');

create index facilities_tenant_activity_type_idx
  on facilities (tenant_id, activity_type_key);

-- Platform catalogue: readable by the app role; writes stay with the
-- operator/migration path (bootstrap default privileges are revoked to
-- DML only where a migration says so; here the standing convention is
-- select-only for closed catalogues).
revoke all on activity_types from app_user;
grant select on activity_types to app_user;
