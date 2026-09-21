-- payment_reversals_uuid7
-- PR2-C8 follow-up — payment_reversals.id defaulted to
-- gen_random_uuid() (v4) in 20260921173408_payment_reversals.sql,
-- which the tenant-conventions scan refuses for new tables. UUIDv7 is
-- generated app-side by the Drizzle schema; drop the database default
-- so every insert is v7 (forward-only: the applied migration is not
-- edited).

alter table payment_reversals alter column id drop default;
