-- Wave 2 (docs/role-surfaces-plan.md) — member_facility_optins.
--
-- Owner decision: members.location_id stays the home/registration
-- facility; this table records additional facilities a member opts
-- into. Charging is per-facility and lands later (C-29 → C-33);
-- this table is the record billing will reference.
--
-- Lifecycle: an active opt-in is a row with ended_on is null. The
-- partial unique index enforces one active row per (member, facility);
-- a member who leaves and rejoins gets a new row, preserving history.
-- The composite FKs mirror every other tenant join table: neither the
-- member nor the facility can belong to another tenant.

create table member_facility_optins (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  member_id     uuid not null,
  location_id   uuid not null,
  opted_on      date not null,
  ended_on      date,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint member_facility_optins_dates_check
    check (ended_on is null or ended_on >= opted_on),
  constraint member_facility_optins_id_tenant_key
    unique (id, tenant_id),
  constraint member_facility_optins_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id),
  constraint member_facility_optins_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id)
);

create unique index member_facility_optins_active_idx
  on member_facility_optins (tenant_id, member_id, location_id)
  where ended_on is null;

create index member_facility_optins_tenant_location_idx
  on member_facility_optins (tenant_id, location_id)
  where ended_on is null;

alter table member_facility_optins enable row level security;
alter table member_facility_optins force row level security;
create policy member_facility_optins_tenant_isolation
  on member_facility_optins
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant insert, update, delete, select on member_facility_optins to app_user;
