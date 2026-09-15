-- C-31 (invoice numbering) — one gapless series per tenant per
-- financial year.
--
-- Decision 2026-09-14: for now 1 tenant = 1 GSTIN, so the series is
-- per tenant (per GSTIN). The counter key is deliberately
-- (tenant_id, financial_year); the day a tenant needs a second GSTIN,
-- the key (or the row) grows a legal_entity reference rather than
-- forcing a renumbering of issued invoices.
--
-- No Postgres sequence: rollbacks leave gaps and GST requires
-- consecutive numbers, so allocation is an in-transaction counter
-- read under `select … for update`.

create table invoice_number_counters (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  financial_year text not null check (financial_year ~ '^\d{4}-\d{2}$'),
  next_number    integer not null default 1 check (next_number > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, financial_year)
);

alter table invoice_number_counters enable row level security;
alter table invoice_number_counters force row level security;

create policy tenant_isolation on invoice_number_counters
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on invoice_number_counters
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on invoice_number_counters
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on invoice_number_counters to app_user;
