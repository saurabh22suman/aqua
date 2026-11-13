-- 20261106170732_booking_check_ins
--
-- The paid-booking entry lane's recorded admission.
--
-- One row per booking per tenant. The table is the authority for "this guest
-- has already been admitted", which is what makes a replayed pass refusable.
-- The booking row remains the schedule/money link; this table is the ARRIVAL.
--
-- Shape decisions:
--
--   * unique (tenant_id, booking_id) is the one-entry-per-booking guarantee,
--     enforced by the database rather than by a read-then-write race. The
--     service also uses this exact constraint name in
--     `on conflict on constraint ... do nothing`, so the name is part of the
--     contract.
--   * location_id is the booking's location. The scan checks the caller's
--     O-08 location access before it reads the money, and the read side can
--     scope by the same column.
--   * checked_in_by is the SCANNING staff user id (users.id), not the member
--     and not the person who minted the pass. The entry is attributable to
--     the person who admitted the guest.
--   * method is 'qr' today. The check keeps the set closed so a later method
--     needs a migration, not a guess.
--   * id is a primary key with NO database default. The uuidv7 is generated
--     app-side by the Drizzle mirror ($defaultFn), the H-02 convention:
--     gen_random_uuid() would hand out a v4 and break the time ordering the
--     indexes rely on.
--   * APPEND-ONLY in two layers:
--       (1) privileges — app_user gets SELECT + INSERT and never UPDATE or
--           DELETE. The deploy's blanket grant re-grants the full DML, so
--           db/app-privileges.ts's append-only list must also carry this
--           table (it does in the completion post-image). That list is the
--           load-bearing half.
--       (2) a BEFORE UPDATE OR DELETE trigger that raises for EVERY role,
--           the table owner and superusers included — the E-03 audit guard's
--           shape. RLS bypass does not bypass triggers.
--   * NO DESTRUCTIVE CASCADE. The evidence of an admission must not be
--     erasable by deleting the thing it records. Every foreign key is
--     ON DELETE RESTRICT, so deleting a booking, a location or a tenant that
--     has a recorded check-in is refused (23503) instead of silently erasing
--     the admission. A privileged teardown must delete booking_check_ins
--     first; the lane's fixture does exactly that through the trigger-disable
--     escape hatch (the same shape as tests/helpers/audit-log-cleanup.ts).
--   * The (id, tenant_id) unique constraint is house parity: it is what lets
--     a future child table reference a check-in the way the rest of the
--     schema references tenant rows.
--
-- This table is intentionally NOT part of the invoice/payment money spine.
-- A check-in records an arrival; the money is collected by hand through the
-- existing recordPayment path (cash with no reference, UPI with a reference).
--
-- Fresh timestamp note: this file must sort after the applied
-- 20261105140000_invoice_paid_correction_deferred.sql. The original completion
-- post-image used 20261105130000, which would sort before an already-applied
-- migration and fail db/migrate.ts's ascending-order guard.

create table booking_check_ins (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id) on delete restrict,
  booking_id    uuid not null,
  location_id   uuid not null,
  method        text not null default 'qr',
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid,
  created_at    timestamptz not null default now(),
  constraint booking_check_ins_id_tenant_key unique (id, tenant_id),
  constraint booking_check_ins_tenant_booking_key unique (tenant_id, booking_id),
  constraint booking_check_ins_method_check check (method in ('qr')),
  constraint booking_check_ins_booking_tenant_fkey
    foreign key (booking_id, tenant_id)
    references bookings(id, tenant_id) on delete restrict,
  constraint booking_check_ins_location_tenant_fkey
    foreign key (location_id, tenant_id)
    references locations(id, tenant_id) on delete restrict
);

create index booking_check_ins_tenant_checked_idx
  on booking_check_ins (tenant_id, checked_in_at desc);

alter table booking_check_ins enable row level security;
alter table booking_check_ins force row level security;

create policy tenant_isolation on booking_check_ins
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- APPEND-ONLY, layer 1 — the privileges. The blanket grant that
-- bootstrapRoles runs on every deploy re-grants UPDATE and DELETE on every
-- existing table, so db/app-privileges.ts's append-only list must carry this
-- table too. The house shape is gate_access_events / activity_events /
-- account_entries.
grant select, insert on booking_check_ins to app_user;
revoke update, delete on booking_check_ins from app_user;

-- APPEND-ONLY, layer 2 — the guard. Every role, the table's owner included:
-- RLS bypass does not bypass triggers, and a privilege check does not stop
-- the owner. The E-03 audit guard's shape, with the same SQLSTATE the
-- privilege denial uses (42501), so a client cannot tell which layer refused
-- it.
create or replace function booking_check_ins_block_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'booking_check_ins is append-only: % is not permitted (id=%)',
    TG_OP,
    coalesce(OLD.id::text, '?')
    using errcode = '42501';
end;
$$;

revoke all on function booking_check_ins_block_mutation() from public;

create trigger booking_check_ins_no_mutate
  before update or delete on booking_check_ins
  for each row
  execute function booking_check_ins_block_mutation();
