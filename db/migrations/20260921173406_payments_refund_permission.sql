-- payments_refund_permission
-- PR2-C8 — the `payments.refund` permission row plus the tenant
-- backfill, in this order: permissions is the FK target for
-- role_permissions.permission_key, so the grant would fail on an
-- existing database if it ran first (same ordering rule as
-- 20260919222900_v23_staff_self_permission.sql). db/seed-platform.ts
-- is the source of truth for the row; a production database after
-- `pnpm db:deploy` has migrations only. Idempotent.

insert into permissions (key, module, description)
values ('payments.refund', 'billing', 'Reverse a recorded payment')
on conflict (key) do nothing;

-- Owner + admin receive every permission through ROLE_TEMPLATES
-- (owner: all; admin: all minus staff.pay.*); the accountant carries
-- an explicit list. The receptionist records payments but must not
-- reverse them (the audit's separation-of-duties point), so it is
-- deliberately absent here.
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'payments.refund'
from roles r
where r.key in ('owner', 'admin', 'accountant')
on conflict do nothing;
