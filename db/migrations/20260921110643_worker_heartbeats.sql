-- worker_heartbeats
-- PR1-C8 — one row per running worker process, upserted on start and
-- every 15 s. Platform-scoped infrastructure (no tenant_id): the
-- worker writes with app_user, /api/health reads the latest beat and
-- returns 503 when it is stale, so a dead worker fails the deploy gate
-- instead of being discovered later. See db/allowlist.ts and
-- lib/health/worker-heartbeat.ts.

create table worker_heartbeats (
  worker_id text primary key,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null
);

grant select, insert, update, delete on worker_heartbeats to app_user;
