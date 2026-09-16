-- platform_metrics_writer scope
--
-- Item 7 (PR #175 audit follow-up) — the snapshot job is the only
-- cross-tenant job in worker/index.ts and writes exactly one row per
-- day into platform_metrics_daily. Today the table is RLS-exempt
-- (db/allowlist.ts) and grants insert/update/delete to app_user with
-- no policy gate — any `withPlatformAdmin` callback could silently
-- write to it because RLS-exempt tables ignore policies entirely.
-- This narrows that surface to fail-closed:
--
--   * withPlatformAdmin (sets app.platform_admin = 'true') can READ
--     platform_metrics_daily via the platform_admin_select policy.
--     It can no longer WRITE — the only write policy requires
--     app.platform_metrics_writer = 'true'.
--   * withPlatformMetricsWriter (sets app.platform_metrics_writer =
--     'true') can write, and the platform_admin_select policy is no
--     longer required for reads inside that scope (the write policy
--     gates all ops when set). It still cannot reach tenant tables
--     — they have no policy keyed on app.platform_metrics_writer.
--
-- Net: the snapshot job is the *only* writer, by mechanical
-- construction rather than convention. tests/tier1/snapshot-job-
-- scope-narrowing.test.ts (proposed in the same PR) proves both
-- directions by mutation.
--
-- RLS on this table: enabled + forced. app_user keeps its `grant
-- select` for completeness but FORCE RLS means the policies are the
-- only path to rows.

alter table platform_metrics_daily enable row level security;
alter table platform_metrics_daily force row level security;

create policy platform_admin_select on platform_metrics_daily
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_metrics_writer on platform_metrics_daily
  for all to app_user
  using (current_setting('app.platform_metrics_writer', true) = 'true')
  with check (current_setting('app.platform_metrics_writer', true) = 'true');

-- Keep the table-level grant intact — RLS policies are access
-- predicates that filter the existing privilege, not grants of
-- their own. FORCE RLS forces app_user (the connection role) to
-- satisfy the policies; the platform_metrics_writer policy is the
-- gate that excludes writes from non-flag scopes. Revoking the
-- table-level grant would short-circuit at the privilege check
-- before RLS is consulted, which is the wrong layer to gate on.
grant select, insert, update, delete on platform_metrics_daily to app_user;
