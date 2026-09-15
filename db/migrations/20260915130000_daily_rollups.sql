-- C-47 (reports.rollup) — precomputed daily summaries.
--
-- One row per tenant per day, upserted by the nightly job
-- (architecture §9's reports.rollup, 03:00 in the tenant's timezone,
-- rolling up the day that just ended). Idempotent by primary key:
-- re-running a night changes nothing.
--
-- The figures are the operational ones the owner dashboard and the
-- reports surfaces keep recomputing live: sessions held, attendance
-- marked, members joined, collections recorded, invoices raised.
-- Money stays integer paise.

create table daily_rollups (
  tenant_id            uuid not null references tenants(id) on delete cascade,
  on_date              date not null,
  sessions_held        integer not null default 0 check (sessions_held >= 0),
  attendance_marked    integer not null default 0 check (attendance_marked >= 0),
  new_members          integer not null default 0 check (new_members >= 0),
  payments_count       integer not null default 0 check (payments_count >= 0),
  collections_paise    bigint not null default 0 check (collections_paise >= 0),
  invoices_issued      integer not null default 0 check (invoices_issued >= 0),
  invoices_total_paise bigint not null default 0 check (invoices_total_paise >= 0),
  computed_at          timestamptz not null default now(),
  primary key (tenant_id, on_date)
);

alter table daily_rollups enable row level security;
alter table daily_rollups force row level security;

create policy tenant_isolation on daily_rollups
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on daily_rollups
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on daily_rollups
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on daily_rollups to app_user;
