-- platform_metrics_daily
--
-- PR3 (ops console improvements) — the Overview KPI cards need
-- period-over-period deltas ("+6% from last month"), which is not
-- computable from anything that exists today: nothing records what
-- the platform's tenant counts looked like in the past. This is a
-- daily snapshot, one row per day, written once by
-- lib/jobs/platform-metrics-snapshot-job.ts (platform.metrics-snapshot
-- queue, worker/index.ts) — the one cross-tenant job in that
-- process (reports.rollup writes the per-tenant summary table
-- daily_rollups under withTenant, separate path); see the comment
-- there for why this is a deliberate, singular exception to "every
-- job is per-tenant."
--
-- Platform-scoped, no tenant_id, no RLS — same treatment as
-- platform_leads / platform_audit_log (db/allowlist.ts). It holds no
-- PII, just aggregate counts.

create table platform_metrics_daily (
  on_date          date primary key,
  active_tenants   integer not null check (active_tenants >= 0),
  trial_tenants    integer not null check (trial_tenants >= 0),
  at_risk_tenants  integer not null check (at_risk_tenants >= 0),
  open_ops_tasks   integer not null check (open_ops_tasks >= 0),
  computed_at      timestamptz not null default now()
);

grant select, insert, update, delete on platform_metrics_daily to app_user;
