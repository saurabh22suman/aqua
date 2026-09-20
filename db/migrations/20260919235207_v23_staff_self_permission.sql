-- 20260919235207_v23_staff_self_permission
--
-- V-23/V-24 — the `staff.self` permission row in the platform
-- catalogue.
--
-- db/seed-platform.ts is the source of truth and inserts this key, but
-- a production database after `pnpm db:deploy` has migrations only
-- (no seed script). `permissions` is the FK target for
-- role_permissions.permission_key, so without this row a fresh
-- deployment's first seedRoleTemplates call fails on the FK — the
-- exact deploy-order class tests/db/catalogue-parity.test.ts and
-- tests/db/catalogue-deploy-order.test.ts pin.
--
-- The earlier staff.self migration (20260919223022) backfilled
-- role_permissions for existing tenants; this one makes the catalogue
-- row itself exist on a fresh, unseeded database. Idempotent.

insert into permissions (key, module, description)
values ('staff.self', 'staff', 'View own roster, mark own attendance and request own leave')
on conflict (key) do nothing;
