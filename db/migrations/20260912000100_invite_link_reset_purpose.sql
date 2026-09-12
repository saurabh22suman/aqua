-- invite_link_uses_purpose CHECK widening: add 'reset' alongside
-- 'invite' and 'relogin'. 2026-09-11 auth feature, slice 2b.
--
-- A 'reset' link is ops-issued, owner-only, 1-hour-TTL. Its redeem
-- path is the same shape as 'invite' + 'relogin' (single-use jti,
-- membership-scoped), but the semantics are different: it forces
-- the set-PIN screen even when a credential exists, and the
-- redeem path overwrites the credential + revokes other sessions.
-- The purpose column records that distinction for audit and so
-- the existing single-use mechanism (invite_link_uses PK on jti)
-- catches double-redeem without an extra code path.
--
-- Forward-only: drop and re-add the constraint, widening the
-- allowed set. No data backfill — existing rows stay untouched.
-- Drop-then-add is the only option because Postgres has no
-- ALTER CONSTRAINT; recreating a CHECK constraint is destructive
-- only of the constraint itself, not of the rows it constrains.

alter table invite_link_uses
  drop constraint invite_link_uses_purpose_check;

alter table invite_link_uses
  add constraint invite_link_uses_purpose_check
  check (purpose in ('invite', 'relogin', 'reset'));
