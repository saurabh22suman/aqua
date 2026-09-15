-- Bug fix (live-attack audit) — createSubscription had zero dedup
-- check: a member with an existing active subscription to a plan could
-- have a second active subscription created for the same member+plan.
-- Verified live: calling createSubscription twice for the same
-- member+plan returned {ok:true} both times and inserted two rows.
--
-- This is the concurrency backstop; lib/services/subscriptions.ts
-- createSubscription now also pre-checks and returns a clear error
-- before insert. Follows the existing partial-index idiom in this
-- table (subscriptions_tenant_ends_idx, subscriptions_tenant_location_idx).
--
-- IMPORTANT — before applying this migration against a database that
-- may already contain violating rows (i.e. production), run this first
-- to detect any existing overlaps; a plain CREATE UNIQUE INDEX will
-- fail outright if any exist:
--
--   select tenant_id, member_id, plan_id, count(*)
--     from subscriptions
--    where status = 'active'
--    group by 1, 2, 3
--   having count(*) > 1;
--
-- If that query returns rows, resolve them (e.g. cancel all but the
-- most recent per group) before this migration runs.

create unique index subscriptions_active_member_plan_uidx
  on subscriptions (tenant_id, member_id, plan_id)
  where status = 'active';
