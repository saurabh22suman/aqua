-- 20260918060000_e01_audit_actor_model
--
-- E-01 (Release 1) — the audit actor model from architecture.md §8.10.
-- Resolves two standing gaps:
--   * F-14: audit_log.actor_id was NOT NULL, so an action with no user
--     actor (platform-side membership activation) could not write.
--   * F-15 (jobs half): subscriptions.expire and renewal invoices mutated
--     with no tenant audit row, because a job has no user actor.
--
-- actor_type defaults to 'user' so the existing writers keep working
-- unchanged; they may pass it explicitly from here on. actor_id becomes
-- nullable. impersonator_id is the §8.10 target shape and lands ahead of
-- support impersonation (3.8) so the column exists before the feature.
--
-- changed_fields is the cheap filter: the field names an update touched,
-- so "every plan change" is an array query instead of a JSONB scan over
-- before/after.
--
-- request_id is H-04's correlation key: middleware generates it, Ctx
-- carries it, and audit rows (and, from E-05, activity_events) share it.

alter table audit_log
  add column actor_type text not null default 'user';
alter table audit_log
  add constraint audit_log_actor_type_check
  check (actor_type in ('user', 'staff', 'system', 'job', 'platform', 'support'));

alter table audit_log alter column actor_id drop not null;

alter table audit_log add column impersonator_id uuid;

alter table audit_log
  add column source text not null default 'web';
alter table audit_log
  add constraint audit_log_source_check
  check (source in ('web', 'job', 'ops', 'api'));

alter table audit_log add column changed_fields text[];
alter table audit_log add column request_id uuid;

-- "every plan change" / "every pay read" queries: tenant + action +
-- time, newest first.
create index audit_log_tenant_action_created_idx
  on audit_log (tenant_id, action, created_at desc);
