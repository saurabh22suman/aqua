-- H-03 — audit_log rebuilt as a monthly RANGE-partitioned table
-- (static horizon).
--
-- MAINTENANCE MODEL — partitions are added by FUTURE MIGRATIONS, the
-- same mechanism E-05 landed for activity_events
-- (20260918070000_e05_activity_events.sql). Runtime creation of
-- partitions is DEFERRED to an H-03 follow-up if a privileged DDL path
-- is ever introduced: app_user has no CREATE privilege, and
-- MIGRATION_DATABASE_URL is migrations-only by design (db/deploy.ts is
-- its only runtime entry point). A pg-boss job cannot create a
-- partition under the app role, so until that path exists, extending
-- the horizon is a migration. The H-03 status note records this
-- change of mechanism.
--
-- HORIZON — monthly partitions are created from the existing rows'
-- earliest month (min(created_at), truncated to its UTC month) through
-- 2028-12 inclusive. When the table is empty (every fresh database,
-- including CI), the fallback start is 2026-01: audit is compliance
-- data whose oldest row cannot be assumed to post-date E-05's
-- 2026-09 activity_events horizon, and the cost of a few extra empty
-- partitions is nil. There is deliberately NO default partition: a
-- beyond-horizon write fails loudly ("no partition of relation
-- audit_log found for row") instead of accumulating in a catch-all
-- no retention policy would ever drop. If rows already exist past
-- 2028-12 the backfill below fails the migration rather than dropping
-- them — the horizon is then wrong and needs a new migration.
--
-- SHAPE — the applied table is preserved exactly (E-01: actor_type,
-- nullable actor_id, impersonator_id, source, changed_fields,
-- request_id, the two CHECKs and the actor_id FK). PRIMARY KEY is
-- (id, created_at) because PostgreSQL requires the partition key in
-- every unique index on a partitioned table; id keeps its bigserial
-- default and the sequence is re-pointed at max(id) after the copy.
--
-- SWAP — everything runs in db/migrate.ts's single transaction:
-- create audit_log_new (partitioned), copy, drop the old table, rename
-- the new one into place, then canonicalise the schema-global names
-- (indexes/constraints were created with _new_ temp names because the
-- canonical ones existed on the old table until the drop). A rollback
-- at any point leaves the old table untouched.
--
-- RLS/GRANTS — same contract as before, plus partition hardening:
-- RLS is enabled + forced with the standard nullif tenant_isolation
-- policy on the parent AND on every partition, because direct
-- partition access does not apply the parent's policies. Grants are
-- SELECT + INSERT only for app_user (bootstrap-roles.ts re-revokes
-- UPDATE/DELETE after its blanket deploy-time grant, or the
-- append-only guarantee would regress on every db:deploy), plus
-- sequence USAGE.

create table audit_log_new (
  id              bigserial,
  tenant_id       uuid not null,
  actor_id        uuid references users(id),
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now(),
  actor_type      text not null default 'user',
  impersonator_id uuid,
  source          text not null default 'web',
  changed_fields  text[],
  request_id      uuid,
  constraint audit_log_new_actor_type_check
    check (actor_type in ('user', 'staff', 'system', 'job', 'platform', 'support')),
  constraint audit_log_new_source_check
    check (source in ('web', 'job', 'ops', 'api')),
  primary key (id, created_at)
) partition by range (created_at);

-- Temp index names: the canonical audit_log_* names belong to the old
-- table until the drop below. Each index created on the partitioned
-- parent is cloned onto every partition automatically.
create index audit_log_new_tenant_id_created_at_idx
  on audit_log_new (tenant_id, created_at desc);
create index audit_log_new_tenant_id_entity_idx
  on audit_log_new (tenant_id, entity_type, entity_id);
create index audit_log_new_tenant_action_created_idx
  on audit_log_new (tenant_id, action, created_at desc);

-- Monthly partitions, UTC boundaries, contiguous from the earliest
-- existing row's month (2026-01 when empty) through 2028-12.
do $$
declare
  start_month date;
  m date;
begin
  select date_trunc('month', min(created_at) at time zone 'UTC')::date
    into start_month
    from audit_log;

  start_month := coalesce(start_month, date '2026-01-01');

  m := start_month;
  while m <= date '2028-12-01' loop
    execute format(
      'create table audit_log_%s partition of audit_log_new for values from (%L) to (%L)',
      to_char(m, 'YYYY_MM'),
      to_char(m, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char((m + interval '1 month')::date, 'YYYY-MM-DD') || ' 00:00:00+00'
    );
    m := (m + interval '1 month')::date;
  end loop;
end
$$;

insert into audit_log_new
  (id, tenant_id, actor_id, action, entity_type, entity_id,
   before, after, ip_address, created_at,
   actor_type, impersonator_id, source, changed_fields, request_id)
select
   id, tenant_id, actor_id, action, entity_type, entity_id,
   before, after, ip_address, created_at,
   actor_type, impersonator_id, source, changed_fields, request_id
  from audit_log;

drop table audit_log;

alter table audit_log_new rename to audit_log;
alter sequence audit_log_new_id_seq rename to audit_log_id_seq;

alter table audit_log rename constraint audit_log_new_pkey to audit_log_pkey;
alter table audit_log rename constraint audit_log_new_actor_type_check to audit_log_actor_type_check;
alter table audit_log rename constraint audit_log_new_source_check to audit_log_source_check;
alter table audit_log rename constraint audit_log_new_actor_id_fkey to audit_log_actor_id_fkey;

alter index audit_log_new_tenant_id_created_at_idx rename to audit_log_tenant_id_created_at_idx;
alter index audit_log_new_tenant_id_entity_idx rename to audit_log_tenant_id_entity_idx;
alter index audit_log_new_tenant_action_created_idx rename to audit_log_tenant_action_created_idx;

-- Explicit ids were copied, so the sequence must not hand out one that
-- already exists. Empty table: leave is_called = false so the next id
-- is 1.
select setval(
  pg_get_serial_sequence('audit_log', 'id'),
  coalesce(max(id), 1),
  max(id) is not null
)
from audit_log;

grant select, insert on audit_log to app_user;
revoke update, delete on audit_log from app_user;
grant usage on sequence audit_log_id_seq to app_user;

alter table audit_log enable row level security;
alter table audit_log force row level security;

create policy tenant_isolation on audit_log
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Partitions: RLS forced with their own copy of the policy, because
-- direct partition access does not apply the parent's policies. The
-- UPDATE/DELETE revokes cover both the reset path (bootstrap runs
-- before this table exists, so default privileges applied at creation)
-- and direct access; bootstrap-roles.ts re-revokes after its blanket
-- deploy-time grant, which would otherwise undo this on every deploy.
do $$
declare
  part regclass;
begin
  for part in
    select inhrelid::regclass
      from pg_inherits
     where inhparent = 'audit_log'::regclass
  loop
    execute format('alter table %s enable row level security', part);
    execute format('alter table %s force row level security', part);
    execute format(
      'create policy tenant_isolation on %s using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      part
    );
    execute format('grant select, insert on %s to app_user', part);
    execute format('revoke update, delete on %s from app_user', part);
  end loop;
end
$$;
