-- Phase R.3 — tenant_holidays. The session generator
-- (lib/jobs/session-generator.ts) loops every batch date within
-- the horizon and creates a session if the batch's daysOfWeek
-- includes that weekday. Without a holiday table, a national
-- holiday on a Tuesday still generates a Tuesday batch, and a
-- coach registers against an empty pool.
--
-- RLS pattern matches every other tenant-scoped table.

create table tenant_holidays (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  -- holiday_date is a calendar date, not a timestamp; the
  -- session generator compares it as a date.
  holiday_date   date not null,
  -- recurring_yearly means the same month-day every year
  -- (e.g. Jan 26 = Republic Day). One-off closures set this
  -- to false and pick a specific year.
  recurring_yearly boolean not null default false,
  -- created_by / audit columns for traceability.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

-- Same name within a tenant cannot repeat. Yearly recurrences
-- (recurring_yearly=true) are unique by month-day; one-off
-- (recurring_yearly=false) by full date.
create unique index tenant_holidays_unique_oneoff
  on tenant_holidays (tenant_id, holiday_date)
  where recurring_yearly = false;
create unique index tenant_holidays_unique_recurring
  on tenant_holidays (tenant_id, extract(month from holiday_date), extract(day from holiday_date))
  where recurring_yearly = true;

create index tenant_holidays_tenant_date_idx
  on tenant_holidays (tenant_id, holiday_date);

alter table tenant_holidays enable row level security;
alter table tenant_holidays force row level security;
create policy tenant_holidays_tenant_isolation
  on tenant_holidays
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant insert, update, delete, select on tenant_holidays to app_user;
