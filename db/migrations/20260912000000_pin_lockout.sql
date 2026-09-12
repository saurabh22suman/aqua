-- Per-account PIN lockout for the phone+PIN login (slice 2a of the
-- 2026-09-11 auth feature). Forward-only.
--
-- Why these columns live on users and not a separate pin_attempts
-- table: a per-account counter is naturally a property of the
-- identity. A separate table adds a row for every existing user on
-- day one and offers no extra capability — the credentials service
-- in lib/services/credentials.ts reads and writes these columns
-- under withPlatform(), the same scope users already sits in.
--
-- Why failed_pin_attempts is NOT NULL with default 0 (rather than
-- nullable): the lockout check is a single `current >= 5` predicate
-- on a guaranteed-integer column. Nullable + coalesce would be one
-- more thing to forget under load. The default is the most common
-- state (never tried).
--
-- Why pin_locked_until is nullable (and the only column that is):
-- NULL = "never locked". A non-null timestamp = "locked until this
-- instant". One comparison per login (`pin_locked_until > now()`)
-- is the entire lockout predicate.
--
-- The threshold (5) and window (15 minutes) are service-layer
-- constants in lib/services/credentials.ts, NOT columns. Moving
-- them to the schema would lock them into a migration every time
-- they need to change — wrong layer.

alter table users
  add column failed_pin_attempts integer not null default 0,
  add column pin_locked_until timestamptz;
