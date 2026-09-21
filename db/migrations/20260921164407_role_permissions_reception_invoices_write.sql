-- role_permissions_reception_invoices_write
-- PR2-C2 — the reception counter raises invoices. The receptionist
-- role in lib/services/roles.ts now carries invoices.write; existing
-- tenants were seeded before that change and need the grant
-- backfilled. Matches by role.key so a renamed receptionist role is
-- untouched; idempotent via on conflict do nothing.

insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'invoices.write'
from roles r
where r.key = 'receptionist'
on conflict do nothing;
