-- C-34 audit fix — cash count variance policy + closed state.
--
-- Two problems found by a live-attack audit of confirmCashCount:
--
-- (a) there was no policy gate on variance at all -- any counted
--     figure closed the day, no matter how large the gap from the
--     system figure.
-- (b) the table's hard unique key on (tenant_id, location_id,
--     on_date), paired with onConflictDoUpdate, meant a second
--     confirm for the same day silently OVERWROTE
--     counted/system/variance in place. The prior value survived
--     only as a separate audit_log row (entity_id null) -- never in
--     the table itself.
--
-- This migration is Fix B's schema half: it adds the closed-state
-- columns and replaces the hard unique key with a partial unique
-- index on the live (superseded_at is null) row -- the same
-- append-only idiom config_values already uses
-- (20260914030000_config_registry.sql: a write supersedes the
-- current live row and inserts a new one, so history comes for
-- free). A "closed" day inserts a new row; reopening supersedes the
-- current live row (status -> 'reopened', superseded_at stamped)
-- rather than overwriting counted/system/variance, so both the
-- original close and any later recount stay independently queryable
-- in the same table.
--
-- Fix A (the ₹500 / ₹2,000 variance policy) is enforced in
-- lib/services/reconciliation.ts, not here -- reusing the existing
-- `note` column as the required-above-₹500 reason, so no schema
-- change is needed for that half.

alter table cash_counts
  add column status text not null default 'closed',
  add column superseded_at timestamptz,
  add column reopened_by uuid,
  add column reopened_at timestamptz,
  add column reopen_reason text;

alter table cash_counts
  add constraint cash_counts_status_check
    check (status in ('closed', 'reopened'));

alter table cash_counts
  add constraint cash_counts_reopen_reason_check
    check (reopen_reason is null or char_length(reopen_reason) between 1 and 500);

-- Drop the hard unique key that made a recount overwrite the row --
-- Fix B's whole point -- and replace it with a partial unique index
-- so at most one LIVE row exists per (tenant, location, day); a
-- reopened row is superseded and no longer counts toward it.
alter table cash_counts drop constraint cash_counts_location_day_key;

create unique index cash_counts_live_uidx
  on cash_counts (tenant_id, location_id, on_date)
  where superseded_at is null;
