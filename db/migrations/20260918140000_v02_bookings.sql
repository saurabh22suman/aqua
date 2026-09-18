-- 20260918140000_v02_bookings
--
-- V-02 (Phase 3, facilities and bookings) — the bookings table and
-- the overlap guarantee, per docs/implementation-plan.md V-02 and
-- architecture.md §8.7.
--
-- Shape decisions:
--   * `id` is UUIDv7 generated app-side — no `gen_random_uuid()`
--     default (H-02 convention; time-ordered and index-friendly).
--   * money is integer paise (`price_paise bigint >= 0`), never a
--     float or numeric. `price_paise` is the GST-inclusive amount the
--     customer pays, snapshotted from the V-03 resolver.
--   * exactly one of member_id / walk_in_name is set: a booking is
--     either attached to a member (billable) or to a named walk-in
--     (recorded, not payable in R1 — the invoice spine needs a
--     member; there is deliberately no anonymous payment path).
--   * composite (id, tenant_id) FKs so a cross-tenant reference
--     cannot typecheck at the database, with tenant-leading indexes.
--   * RLS: enable + force, the standard nullif tenant_isolation
--     policy; grants match the other Release 1 tables. `invoice_id`
--     links to the single invoice the booking flow issues
--     (source='other'); a partial unique index is not needed because
--     billing locks the booking row FOR UPDATE before issuing.
--
-- The overlap guarantee is the EXCLUDE constraint, not application
-- logic. `btree_gist` was installed by migration 0001; the constraint
-- is race-proof under concurrency in a way that a check-then-insert
-- never is. The range is half-open [starts_at, ends_at) so adjacent
-- slots (11:00→12:00 and 12:00→13:00) do not conflict. A NULL
-- sub-unit (whole facility) collapses to the nil uuid so it
-- conflicts with itself; cancelled and completed bookings are
-- excluded by the partial WHERE, freeing their slot.

create table bookings (
  id           uuid not null,               -- UUIDv7, generated app-side
  tenant_id    uuid not null references tenants(id) on delete cascade,
  location_id  uuid not null,
  facility_id  uuid not null,
  sub_unit_id  uuid,
  member_id    uuid,
  walk_in_name text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'confirmed',
  price_paise  bigint not null,
  notes        text,
  invoice_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint bookings_id_tenant_key unique (id, tenant_id),
  constraint bookings_time_check check (ends_at > starts_at),
  constraint bookings_status_check
    check (status in ('held', 'confirmed', 'cancelled', 'completed')),
  constraint bookings_price_check check (price_paise >= 0),
  constraint bookings_person_check
    check ((member_id is not null) <> (walk_in_name is not null)),
  constraint bookings_walk_in_name_check
    check (walk_in_name is null or char_length(walk_in_name) between 1 and 120),
  constraint bookings_notes_check
    check (notes is null or char_length(notes) <= 500),
  constraint bookings_location_tenant_fkey
    foreign key (location_id, tenant_id)
    references locations (id, tenant_id),
  constraint bookings_facility_tenant_fkey
    foreign key (facility_id, tenant_id)
    references facilities (id, tenant_id),
  constraint bookings_sub_unit_tenant_fkey
    foreign key (sub_unit_id, tenant_id)
    references facility_sub_units (id, tenant_id),
  constraint bookings_member_tenant_fkey
    foreign key (member_id, tenant_id)
    references members (id, tenant_id),
  constraint bookings_invoice_tenant_fkey
    foreign key (invoice_id, tenant_id)
    references invoices (id, tenant_id)
);

-- The overlap guarantee. Applied as written in the task and
-- architecture §8.7: tenant + facility + (sub-unit or whole) + time
-- range, for held and confirmed bookings.
alter table bookings add constraint bookings_no_overlap_excl
  exclude using gist (
    tenant_id with =,
    facility_id with =,
    (coalesce(sub_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('held', 'confirmed'));

create index bookings_tenant_starts_idx
  on bookings (tenant_id, starts_at);
create index bookings_tenant_location_starts_idx
  on bookings (tenant_id, location_id, starts_at);
create index bookings_tenant_facility_starts_idx
  on bookings (tenant_id, facility_id, starts_at);
create index bookings_tenant_member_starts_idx
  on bookings (tenant_id, member_id, starts_at)
  where member_id is not null;
create index bookings_tenant_invoice_idx
  on bookings (tenant_id, invoice_id)
  where invoice_id is not null;

alter table bookings enable row level security;
alter table bookings force row level security;

create policy tenant_isolation on bookings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on bookings to app_user;
