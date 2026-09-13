-- R.8 (docs/five-day-work-guide.md, V-20) — absence alerts.
--
-- Owner decisions 2026-09-13:
--   * low-attendance threshold is owner-configurable, default 50%;
--   * the monthly alert needs at least 4 recorded marks (noise guard,
--     fixed, not configurable);
--   * in-app only (no WhatsApp; no C-43 dependency);
--   * read-only alerts (no acknowledgement state).
--
-- Dedupe: one alert per (member, batch, kind, calendar_week) — three
-- consecutive absences trigger one alert, not three (V-20 done-when).

alter table tenants
  add column absence_alert_threshold_pct integer not null default 50;

alter table tenants
  add constraint tenants_absence_alert_threshold_check
  check (absence_alert_threshold_pct between 0 and 100);

create table absence_alerts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  member_id     uuid not null,
  batch_id      uuid not null,
  alert_kind    text not null,
  calendar_week text not null,
  detail        jsonb,
  created_at    timestamptz not null default now(),
  constraint absence_alerts_kind_check
    check (alert_kind in ('consecutive_absences', 'low_monthly_attendance')),
  constraint absence_alerts_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id),
  constraint absence_alerts_batch_tenant_fkey
    foreign key (batch_id, tenant_id) references batches (id, tenant_id),
  constraint absence_alerts_dedupe_key
    unique (tenant_id, member_id, batch_id, alert_kind, calendar_week)
);

create index absence_alerts_tenant_created_idx
  on absence_alerts (tenant_id, created_at desc);

alter table absence_alerts enable row level security;
alter table absence_alerts force row level security;
create policy absence_alerts_tenant_isolation
  on absence_alerts
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

-- Insert (the daily job) + select (coach member detail, parent page).
-- No update/delete: alerts are read-only by design.
grant select, insert on absence_alerts to app_user;
