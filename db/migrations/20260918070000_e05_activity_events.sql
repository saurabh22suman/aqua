-- activity_events (E-05, architecture.md §8.11)
--
-- The product/operational event stream, deliberately separate from
-- audit_log: audit is compliance (never deleted, joins to domain
-- state, can hold sensitive before/after), events are analytics
-- (safe to lose, rolled up and dropped by partition, no PII). The
-- two join by request_id and entity_id when reconstructing "what
-- did the user see and what changed".
--
-- Envelope per §8.11. `occurred_at` is the business/client clock and
-- is the partition key; `received_at` is the server clock. `id` is a
-- UUIDv7 generated app-side — no gen_random_uuid() default (H-02
-- convention; UUIDv7 is time-ordered and index-friendly).
--
-- IDEMPOTENCY — the one deviation from §8.11's literal index sketch.
-- PostgreSQL requires every unique index on a partitioned table to
-- include the partition key, so the plan's unique (tenant_id,
-- client_event_id) becomes unique (tenant_id, client_event_id,
-- occurred_at). Consequence: a retry MUST resend the ORIGINAL
-- occurred_at for a given client_event_id or it lands as a second
-- row. The emit path freezes occurred_at into the pg-boss payload
-- (lib/events/emit.ts), so job redeliveries are idempotent; a caller
-- that re-emits a new occurred_at is declaring a new event.
--
-- PARTITIONS. Monthly range partitions 2026-09 .. 2028-12 are created
-- here, explicitly. There is deliberately NO default partition: an
-- out-of-horizon write fails loudly ("no partition of relation
-- activity_events found for row") instead of silently accumulating
-- in a catch-all that no retention policy would ever drop. Automatic
-- partition extension is DEFERRED: creating a partition is DDL and
-- app_user has no CREATE privilege, so the future job that extends
-- the horizon (E-06) needs a privileged DDL path, not an app_user
-- write. Until then, extending the horizon is a migration.
--
-- RLS: enable + force with the standard nullif tenant policy. Every
-- partition also gets RLS forced with no policy of its own: direct
-- partition access bypasses the parent's policies in PostgreSQL, so
-- without this an app_user query naming a partition could read across
-- tenants. Queries through the parent apply the parent policy and are
-- unaffected.
--
-- GRANTS: SELECT + INSERT only. bootstrap-roles.ts's ALTER DEFAULT
-- PRIVILEGES grants app_user arwd on every table created by aqua, so
-- the UPDATE/DELETE revokes below are load-bearing — append-only is
-- the contract (E-06 drops whole partitions, never rows). The revokes
-- here cover the reset path (bootstrap runs before this table exists);
-- bootstrap-roles.ts re-revokes after its own blanket "all tables"
-- GRANT on every deploy, which would otherwise undo this on the next
-- db:deploy.

create table activity_events (
  id              uuid not null,          -- UUIDv7, generated app-side
  tenant_id       uuid not null,
  occurred_at     timestamptz not null,   -- business/client clock
  received_at     timestamptz not null default now(),
  actor_id        uuid,
  actor_kind      text,
  session_id      text,
  request_id      uuid,
  event_name      text not null,          -- registry-enforced snake_case
  entity_type     text,
  entity_id       uuid,
  properties      jsonb not null default '{}',
  context         jsonb not null default '{}',
  source          text not null,          -- web | job | ops | api
  client_event_id text not null
) partition by range (occurred_at);

-- Horizon: 2026-09 through 2028-12, UTC month boundaries.
create table activity_events_2026_09 partition of activity_events
  for values from ('2026-09-01 00:00:00+00') to ('2026-10-01 00:00:00+00');
create table activity_events_2026_10 partition of activity_events
  for values from ('2026-10-01 00:00:00+00') to ('2026-11-01 00:00:00+00');
create table activity_events_2026_11 partition of activity_events
  for values from ('2026-11-01 00:00:00+00') to ('2026-12-01 00:00:00+00');
create table activity_events_2026_12 partition of activity_events
  for values from ('2026-12-01 00:00:00+00') to ('2027-01-01 00:00:00+00');
create table activity_events_2027_01 partition of activity_events
  for values from ('2027-01-01 00:00:00+00') to ('2027-02-01 00:00:00+00');
create table activity_events_2027_02 partition of activity_events
  for values from ('2027-02-01 00:00:00+00') to ('2027-03-01 00:00:00+00');
create table activity_events_2027_03 partition of activity_events
  for values from ('2027-03-01 00:00:00+00') to ('2027-04-01 00:00:00+00');
create table activity_events_2027_04 partition of activity_events
  for values from ('2027-04-01 00:00:00+00') to ('2027-05-01 00:00:00+00');
create table activity_events_2027_05 partition of activity_events
  for values from ('2027-05-01 00:00:00+00') to ('2027-06-01 00:00:00+00');
create table activity_events_2027_06 partition of activity_events
  for values from ('2027-06-01 00:00:00+00') to ('2027-07-01 00:00:00+00');
create table activity_events_2027_07 partition of activity_events
  for values from ('2027-07-01 00:00:00+00') to ('2027-08-01 00:00:00+00');
create table activity_events_2027_08 partition of activity_events
  for values from ('2027-08-01 00:00:00+00') to ('2027-09-01 00:00:00+00');
create table activity_events_2027_09 partition of activity_events
  for values from ('2027-09-01 00:00:00+00') to ('2027-10-01 00:00:00+00');
create table activity_events_2027_10 partition of activity_events
  for values from ('2027-10-01 00:00:00+00') to ('2027-11-01 00:00:00+00');
create table activity_events_2027_11 partition of activity_events
  for values from ('2027-11-01 00:00:00+00') to ('2027-12-01 00:00:00+00');
create table activity_events_2027_12 partition of activity_events
  for values from ('2027-12-01 00:00:00+00') to ('2028-01-01 00:00:00+00');
create table activity_events_2028_01 partition of activity_events
  for values from ('2028-01-01 00:00:00+00') to ('2028-02-01 00:00:00+00');
create table activity_events_2028_02 partition of activity_events
  for values from ('2028-02-01 00:00:00+00') to ('2028-03-01 00:00:00+00');
create table activity_events_2028_03 partition of activity_events
  for values from ('2028-03-01 00:00:00+00') to ('2028-04-01 00:00:00+00');
create table activity_events_2028_04 partition of activity_events
  for values from ('2028-04-01 00:00:00+00') to ('2028-05-01 00:00:00+00');
create table activity_events_2028_05 partition of activity_events
  for values from ('2028-05-01 00:00:00+00') to ('2028-06-01 00:00:00+00');
create table activity_events_2028_06 partition of activity_events
  for values from ('2028-06-01 00:00:00+00') to ('2028-07-01 00:00:00+00');
create table activity_events_2028_07 partition of activity_events
  for values from ('2028-07-01 00:00:00+00') to ('2028-08-01 00:00:00+00');
create table activity_events_2028_08 partition of activity_events
  for values from ('2028-08-01 00:00:00+00') to ('2028-09-01 00:00:00+00');
create table activity_events_2028_09 partition of activity_events
  for values from ('2028-09-01 00:00:00+00') to ('2028-10-01 00:00:00+00');
create table activity_events_2028_10 partition of activity_events
  for values from ('2028-10-01 00:00:00+00') to ('2028-11-01 00:00:00+00');
create table activity_events_2028_11 partition of activity_events
  for values from ('2028-11-01 00:00:00+00') to ('2028-12-01 00:00:00+00');
create table activity_events_2028_12 partition of activity_events
  for values from ('2028-12-01 00:00:00+00') to ('2029-01-01 00:00:00+00');

-- Unique index: the identity that makes delivery idempotent. The
-- partition key is required in the column list (see the header) —
-- do not "simplify" this to (tenant_id, client_event_id).
create unique index activity_events_tenant_client_occurred_uidx
  on activity_events (tenant_id, client_event_id, occurred_at);

create index activity_events_tenant_occurred_idx
  on activity_events (tenant_id, occurred_at desc);

create index activity_events_tenant_name_occurred_idx
  on activity_events (tenant_id, event_name, occurred_at desc);

alter table activity_events enable row level security;
alter table activity_events force row level security;

create policy tenant_isolation on activity_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only for the app role: reads through withTenant(), writes
-- through the ingest job. No UPDATE/DELETE.
grant select, insert on activity_events to app_user;
revoke update, delete on activity_events from app_user;

-- Partitions: RLS forced (no policy — direct access is denied; parent
-- queries use the parent policy) and the default-privilege UPDATE/
-- DELETE grants revoked. The parent's grants do not cover direct
-- partition access, and the default privileges do, so this loop is
-- what closes that seam for every partition the migration creates.
do $$
declare
  part regclass;
begin
  for part in
    select inhrelid::regclass
      from pg_inherits
     where inhparent = 'activity_events'::regclass
  loop
    execute format('alter table %s enable row level security', part);
    execute format('alter table %s force row level security', part);
    execute format('revoke update, delete on %s from app_user', part);
  end loop;
end
$$;
