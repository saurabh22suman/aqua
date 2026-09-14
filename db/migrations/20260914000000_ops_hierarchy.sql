-- O-01 (docs/ops-platform-design.md §8) — the hierarchy foundation.
--
-- Four levels are fixed for every tenant: tenant → location →
-- facility → sub-unit. This migration gives locations a `kind`,
-- binds every facility to a location, adds the staff↔location join
-- table, and repairs/creates the primary-location invariant so the
-- rest of the ops spine can resolve values against a location
-- without special-casing tenants that predate it.
--
-- Not decided here: legal entities / GSTIN-scoped invoice numbering
-- (design doc §8 "Open question"). locations.legal_entity_id lands
-- only when that question is answered; C-31 currently specifies
-- per-tenant numbering and must be settled before invoices exist.

-- 1. locations.kind — the set is fixed for everyone; which kind a
-- row takes is data. Single-site tenants never see the concept.
alter table locations add column kind text not null default 'club';
alter table locations
  add constraint locations_kind_check
  check (kind in ('club', 'cafe', 'mixed'));

-- 2. Primary-location invariant: at most one live primary per
-- tenant. Where rows disagree, keep the earliest and unset the
-- rest — deterministic, and the unique index below needs it.
with ranked as (
  select id,
         row_number() over (
           partition by tenant_id order by created_at asc, id asc
         ) as rn
  from locations
  where is_primary
    and deleted_at is null
)
update locations l
   set is_primary = false
  from ranked r
 where l.id = r.id
   and r.rn > 1;

-- Every live tenant with at least one live location gets a primary.
update locations l
   set is_primary = true
 where l.deleted_at is null
   and l.id = (
     select l2.id
       from locations l2
      where l2.tenant_id = l.tenant_id
        and l2.deleted_at is null
      order by l2.created_at asc, l2.id asc
      limit 1
   )
   and not exists (
     select 1
       from locations p
      where p.tenant_id = l.tenant_id
        and p.is_primary
        and p.deleted_at is null
   )
   and exists (
     select 1
       from tenants t
      where t.id = l.tenant_id
        and t.status <> 'churned'
   );

-- A non-churned tenant with no live location at all gets one
-- auto-created. Churned tenants are terminal; the concept is
-- meaningless for them and the demo runbook relies on a tenant
-- that can have zero locations.
insert into locations (id, tenant_id, name, is_primary, kind)
select gen_random_uuid(), t.id, 'Main Location', true, 'club'
  from tenants t
 where t.status <> 'churned'
   and not exists (
     select 1
       from locations l
      where l.tenant_id = t.id
        and l.deleted_at is null
   );

create unique index locations_tenant_primary_uidx
  on locations (tenant_id)
  where is_primary
    and deleted_at is null;

-- 3. facilities.location_id — a facility is a bookable resource at
-- a site. Backfilled to the tenant's primary location (oldest live
-- fallback), then NOT NULL: a facility with no site cannot resolve.
alter table facilities add column location_id uuid;

update facilities f
   set location_id = (
     select l.id
       from locations l
      where l.tenant_id = f.tenant_id
        and l.deleted_at is null
      order by l.is_primary desc, l.created_at asc, l.id asc
      limit 1
   );

alter table facilities alter column location_id set not null;

-- on delete cascade: locations are soft-deleted in normal use, so
-- the hard-delete path is cleanup. A facility with no site cannot
-- exist; cascading keeps the invariant rather than blocking a
-- legitimate purge on a stale child row.
alter table facilities
  add constraint facilities_location_tenant_fkey
  foreign key (location_id, tenant_id) references locations (id, tenant_id)
  on delete cascade;

create index facilities_tenant_location_idx
  on facilities (tenant_id, location_id);

-- The closed kind set gains 'counter' — the café counter is a
-- facility like any other (design doc §8's café example). Which
-- kinds exist stays fixed; which one a row is, is data.
alter table facilities drop constraint facilities_kind_check;
alter table facilities
  add constraint facilities_kind_check
  check (kind in ('pool', 'court', 'turf', 'studio', 'field', 'counter'));

-- 4. staff_locations — staff are many-to-many with locations.
-- is_primary marks a staff member's home site; the partial unique
-- index keeps it to one per staff member.
create table staff_locations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  staff_id    uuid not null,
  location_id uuid not null,
  is_primary  boolean not null default false,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint staff_locations_id_tenant_key unique (id, tenant_id),
  constraint staff_locations_staff_tenant_fkey
    foreign key (staff_id, tenant_id) references staff (id, tenant_id)
    on delete cascade,
  constraint staff_locations_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id)
    on delete cascade
);

create unique index staff_locations_tenant_staff_location_key
  on staff_locations (tenant_id, staff_id, location_id);

create unique index staff_locations_tenant_staff_primary_uidx
  on staff_locations (tenant_id, staff_id)
  where is_primary;

create index staff_locations_tenant_location_idx
  on staff_locations (tenant_id, location_id);

alter table staff_locations enable row level security;
alter table staff_locations force row level security;
create policy staff_locations_tenant_isolation
  on staff_locations
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

-- Existing staff default to their tenant's primary location, so
-- the location-scoped access config (O-08, default off) has
-- well-defined data the day it is switched on.
insert into staff_locations (tenant_id, staff_id, location_id, is_primary)
select s.tenant_id,
       s.id,
       l.id,
       true
  from staff s
  join lateral (
    select l.id
      from locations l
     where l.tenant_id = s.tenant_id
       and l.deleted_at is null
     order by l.is_primary desc, l.created_at asc, l.id asc
     limit 1
  ) l on true
 where s.deleted_at is null
on conflict (tenant_id, staff_id, location_id) do nothing;

grant insert, update, delete, select on staff_locations to app_user;
