-- 20260919222900_v23_staff_self_permission
--
-- V-23/V-24 — the `staff.self` permission row in the platform
-- catalogue.
--
-- ORDER MATTERS: this migration is deliberately timestamped before
-- 20260919223022_v23_staff_self_backfill.sql. `permissions` is the FK
-- target for role_permissions.permission_key, so on an existing
-- database (tenants and roles already present) the role backfill
-- would fail on the FK if it ran first. On a fresh database the
-- backfill is a no-op (no roles yet), but the ordering must still be
-- correct for upgrades.
--
-- db/seed-platform.ts is the source of truth and inserts this key, but
-- a production database after `pnpm db:deploy` has migrations only
-- (no seed script) — the exact deploy-order class
-- tests/db/catalogue-parity.test.ts and
-- tests/db/catalogue-deploy-order.test.ts pin.
--
-- Idempotent.

insert into permissions (key, module, description)
values ('staff.self', 'staff', 'View own roster, mark own attendance and request own leave')
on conflict (key) do nothing;
