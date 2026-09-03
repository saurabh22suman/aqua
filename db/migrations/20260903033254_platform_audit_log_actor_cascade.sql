-- platform_audit_log_actor_cascade
--
-- platform_audit_log.actor_id referenced platform_users(id) with no ON
-- DELETE clause (defaults to NO ACTION). scripts/seed-platform-user.ts
-- is documented as the recovery path for a stuck platform login: it
-- deletes the platform_users row for the email and re-provisions a
-- fresh one. Once that user had logged in even once, an audit row
-- existed with actor_id pointing at them, and the delete threw
-- platform_audit_log_actor_id_fkey — the documented recovery path
-- crashed exactly when it was needed.
--
-- ON DELETE SET NULL, not CASCADE: platform_audit_log is an audit
-- trail (append-only, per db/CLAUDE.md's architecture reference for
-- the tenant-side equivalent) — the row must survive even if the
-- actor who caused it no longer exists. Only the reference goes null.

alter table platform_audit_log
  drop constraint platform_audit_log_actor_id_fkey,
  add constraint platform_audit_log_actor_id_fkey
    foreign key (actor_id) references platform_users(id) on delete set null;
