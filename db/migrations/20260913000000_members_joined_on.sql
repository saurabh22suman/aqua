-- Wave 2 (docs/role-surfaces-plan.md) — members.joined_on.
--
-- Owner decision: nullable date, backfilled from created_at, editable
-- so backdated admissions and future imports work. Display falls back
-- to created_at when null (lib/services/people.ts).
--
-- The backfill uses created_at::date (UTC). A tenant-timezone backfill
-- is not expressible in pure SQL without a tz table; the difference is
-- at most one day for rows created between 00:00 and 05:30 IST, and
-- the value is editable per member. New rows are written by
-- createMember in the tenant's timezone.

alter table members add column joined_on date;

update members
   set joined_on = created_at::date
 where joined_on is null;
