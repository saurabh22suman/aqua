-- E-06 (events.rollup) — event counters on the daily rollup.
--
-- events.rollup runs at 03:15 tenant-local, after reports.rollup (03:00)
-- has upserted the same (tenant_id, on_date) row, and fills in only
-- these two columns: event_counts = { event_name: count } for that
-- tenant-local day, events_total = their sum. The two jobs share one
-- row by design, so each upsert updates only its own columns and
-- never clobbers the other's (the jobs' on-conflict set lists are
-- disjoint apart from computed_at).
--
-- DEFERRED — the other half of E-06 is explicitly out of scope in
-- this workstream:
--   1. R2/Parquet export of closed partitions (one file per
--      tenant-day, re-importable in DuckDB) — no R2 integration
--      exists; receipts and payment QRs still live in Postgres.
--   2. Dropping raw activity_events partitions older than the
--      retention window (default 180 days) — partition DROP is DDL,
--      and app_user has no CREATE/DROP; MIGRATION_DATABASE_URL is
--      migrations-only by design and never reaches a runtime job.
--      Retention stays a migration / manual ops step until a
--      privileged DDL path exists (see the E-05 migration's
--      PARTITIONS note).

alter table daily_rollups
  add column event_counts jsonb not null default '{}'::jsonb,
  add column events_total integer not null default 0 check (events_total >= 0);
