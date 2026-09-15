-- C-34 (daily reconciliation) — the cash count confirmation step.
--
-- The daily collection report is computed live from payments; this
-- table records the human confirmation that the physical cash counted
-- at the desk matches (or how it differs from) what the system says.
-- system_paise is snapshotted at confirmation time so the variance
-- stays explainable even if a late payment is recorded afterwards.
--
-- One confirmation per tenant + location + day: re-confirming replaces
-- the previous count (with an audit row), which is how a recount after
-- finding a note behind the drawer actually behaves.
--
-- variance_paise = counted - system; negative means the drawer is
-- short. Integer paise; a variance is a fact to surface, never a
-- correction to apply silently.

create table cash_counts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  location_id    uuid not null,
  on_date        date not null,
  counted_paise  bigint not null check (counted_paise >= 0),
  system_paise   bigint not null check (system_paise >= 0),
  variance_paise bigint not null,
  note           text,
  confirmed_by   uuid,
  confirmed_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cash_counts_variance_check
    check (variance_paise = counted_paise - system_paise),
  constraint cash_counts_note_check
    check (note is null or char_length(note) between 1 and 500),
  constraint cash_counts_id_tenant_key unique (id, tenant_id),
  constraint cash_counts_location_day_key
    unique (tenant_id, location_id, on_date),
  constraint cash_counts_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id)
);

create index cash_counts_tenant_date_idx
  on cash_counts (tenant_id, on_date desc);

alter table cash_counts enable row level security;
alter table cash_counts force row level security;

create policy tenant_isolation on cash_counts
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on cash_counts
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on cash_counts
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on cash_counts to app_user;
