-- 20260919222556_v23_shifts
--
-- V-23 (Phase 3B, staff attendance and pay) — shift templates and the
-- weekly roster, per docs/implementation-plan.md V-23 and
-- architecture.md §8.9.
--
-- Shape decisions:
--   * `id` is UUIDv7 generated app-side (H-02 convention).
--   * `days_of_week` follows the codebase's weekday numbering —
--     0 = Sunday .. 6 = Saturday, the same as lib/time/tz.ts
--     weekdayOf() — so the roster builder maps a date to its
--     template days without a translation table.
--   * `shifts.start_at`/`end_at` are timestamptz: the template's wall
--     times are materialised through zonedWallTimeToInstant() at the
--     tenant's timezone, never stored as wall time on the shift.
--   * `published_at` is the draft/published gate: a shift is invisible
--     to its staff member until the owner publishes the week. The
--     architecture sketch has no column for this; without it "publish
--     to staff" has nowhere to live.
--   * composite (id, tenant_id) FKs + tenant-leading indexes, RLS
--     enable + force with the standard nullif tenant_isolation policy.
--   * the unique key (tenant_id, staff_id, shift_date, start_at)
--     refuses a duplicate shift for the same person at the same
--     instant; overlapping-but-not-identical shifts are a roster
--     mistake the owner sees, not a database error.

create table shift_templates (
  id           uuid not null,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  location_id  uuid not null,
  name         text not null,
  start_time   time not null,
  end_time     time not null,
  days_of_week int[] not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint shift_templates_id_tenant_key unique (id, tenant_id),
  constraint shift_templates_time_check check (end_time > start_time),
  constraint shift_templates_days_check
    check (cardinality(days_of_week) between 1 and 7
           and days_of_week <@ array[0,1,2,3,4,5,6]),
  constraint shift_templates_name_check
    check (char_length(name) between 1 and 80),
  constraint shift_templates_location_tenant_fkey
    foreign key (location_id, tenant_id)
    references locations (id, tenant_id)
);

create index shift_templates_tenant_location_idx
  on shift_templates (tenant_id, location_id);

create table shifts (
  id           uuid not null,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  staff_id     uuid not null,
  location_id  uuid not null,
  template_id  uuid,
  shift_date   date not null,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  status       text not null default 'rostered',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint shifts_id_tenant_key unique (id, tenant_id),
  constraint shifts_staff_slot_key
    unique (tenant_id, staff_id, shift_date, start_at),
  constraint shifts_time_check check (end_at > start_at),
  constraint shifts_status_check
    check (status in ('rostered', 'worked', 'absent', 'leave')),
  constraint shifts_staff_tenant_fkey
    foreign key (staff_id, tenant_id) references staff (id, tenant_id),
  constraint shifts_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id),
  constraint shifts_template_tenant_fkey
    foreign key (template_id, tenant_id)
    references shift_templates (id, tenant_id)
);

create index shifts_tenant_date_staff_idx
  on shifts (tenant_id, shift_date, staff_id);
create index shifts_tenant_staff_date_idx
  on shifts (tenant_id, staff_id, shift_date);

alter table shift_templates enable row level security;
alter table shift_templates force row level security;

create policy tenant_isolation on shift_templates
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on shift_templates to app_user;

alter table shifts enable row level security;
alter table shifts force row level security;

create policy tenant_isolation on shifts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on shifts to app_user;
