-- 20260918141000_v03_booking_pricing
--
-- V-03 (Phase 3, slots and pricing) — the price-rule catalogue plus
-- the advance-booking window config key, per
-- docs/implementation-plan.md V-03.
--
-- Shape decisions:
--   * `id` is UUIDv7 generated app-side (H-02 convention).
--   * `facility_id` NULL means "all facilities at the tenant" — the
--     catch-all default. The composite FK is MATCH SIMPLE, so a NULL
--     facility_id skips enforcement (correct: there is no facility to
--     point at).
--   * `days_of_week` is an int[] with 0 = Sunday (matches JS
--     getDay / lib/time/tz weekdayOf). Empty = every day.
--   * `start_time`/`end_time` are wall-clock times in the tenant's
--     timezone. Both NULL = all day; a check keeps them
--     both-or-neither and end > start. The resolver matches a rule
--     when the booking's local start time falls inside [start, end).
--   * `price_paise` is integer paise, GST-inclusive (the customer
--     pays the quoted price; the bill splits it for GST).
--   * resolution order: highest priority, then facility-specific,
--     then narrowest window, then narrower day set — see
--     lib/services/booking-pricing.ts.
--
-- RLS + grants match the other Release 1 tables. The advance window
-- is a config key, not a column: it resolves through the standard
-- waterfall (platform → tenant → location) so one club's "book 7
-- days ahead" does not need a schema change.

create table booking_price_rules (
  id           uuid not null,               -- UUIDv7, generated app-side
  tenant_id    uuid not null references tenants(id) on delete cascade,
  facility_id  uuid,
  label        text not null,
  days_of_week int[] not null default '{}',
  start_time   time,
  end_time     time,
  price_paise  bigint not null,
  priority     integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint booking_price_rules_id_tenant_key unique (id, tenant_id),
  constraint booking_price_rules_label_check
    check (char_length(label) between 1 and 80),
  constraint booking_price_rules_price_check check (price_paise >= 0),
  constraint booking_price_rules_days_check
    check (days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]),
  constraint booking_price_rules_window_check
    check (
      (start_time is null) = (end_time is null)
      and (start_time is null or end_time > start_time)
    ),
  constraint booking_price_rules_facility_tenant_fkey
    foreign key (facility_id, tenant_id)
    references facilities (id, tenant_id)
);

create index booking_price_rules_tenant_active_idx
  on booking_price_rules (tenant_id, is_active, facility_id);
create index booking_price_rules_tenant_facility_idx
  on booking_price_rules (tenant_id, facility_id);

alter table booking_price_rules enable row level security;
alter table booking_price_rules force row level security;

create policy tenant_isolation on booking_price_rules
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on booking_price_rules to app_user;

-- The advance-booking window (O-04 config registry). The catalogue
-- row is bootstrapped here because a fresh db:deploy has not run
-- db/seed-platform.ts; that seed re-asserts the code version
-- (db/config-definitions.ts) idempotently on every pretest run.
insert into config_keys (key, value_schema, default_value, visibility, risk, description)
values (
  'bookings.advance_window_days',
  '{"type":"integer","minimum":1,"maximum":365}'::jsonb,
  '30'::jsonb,
  'owner_edit',
  'safe',
  'How many days ahead a facility booking can be made. Default 30.'
)
on conflict (key) do nothing;
