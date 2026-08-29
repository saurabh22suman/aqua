-- issue #4's postmortem: we have been wrong twice about the offline
-- write-path race being closed (5/5 fail -> 2/5 fail -> 5/5 clean).
-- A real kill switch, flippable without a deploy, is what makes a
-- fourth surprise survivable. Per-tenant, not a single global env var
-- (feat/offline-sync-flag, never merged) -- rollout is a canary onto
-- one specific tenant, not an all-or-nothing switch for every tenant
-- on a shared plan.
alter table tenants
  add column offline_sync_enabled boolean not null default false;
