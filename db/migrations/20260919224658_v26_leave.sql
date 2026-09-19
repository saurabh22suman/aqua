-- 20260919224658_v26_leave
--
-- V-26 (Phase 3B, staff attendance and pay) — leave types and
-- requests, per docs/implementation-plan.md V-26 and architecture.md
-- §8.9.
--
-- Shape decisions:
--   * `annual_quota` NULL means unlimited; a quota is days per
--     calendar year (the leave year is the calendar year — stated
--     assumption, recorded in the service).
--   * `is_paid` distinguishes unpaid leave; V-30's payout computation
--     reads it to deduct unpaid days.
--   * `days` is numeric(4,1) (architecture sketch) so half days fit
--     later; this pass writes whole days.
--   * `decided_by`/`decided_at` are set together or not at all; a
--     rejected/approved request keeps its decider for the audit trail.
--   * `platform_admin_write` on leave_types exists for one path:
--     tenant provisioning seeds the casual/sick/unpaid defaults inside
--     the same platform-admin transaction that creates the tenant
--     (db/platform-tenant-create.ts), matching seedRoleTemplates.
--   * the backfill seeds the same defaults for every existing tenant,
--     idempotently by (tenant_id, name).
--   * composite (id, tenant_id) FKs + tenant-leading indexes, RLS
--     enable + force, standard nullif tenant_isolation policy.

create table leave_types (
  id           uuid not null,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  annual_quota int,
  is_paid      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint leave_types_id_tenant_key unique (id, tenant_id),
  constraint leave_types_tenant_name_key unique (tenant_id, name),
  constraint leave_types_name_check check (char_length(name) between 1 and 60),
  constraint leave_types_quota_check check (annual_quota is null or annual_quota >= 0)
);

create table leave_requests (
  id             uuid not null,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  staff_id       uuid not null,
  leave_type_id  uuid not null,
  from_date      date not null,
  to_date        date not null,
  days           numeric(4,1) not null,
  reason         text,
  status         text not null default 'pending',
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  constraint leave_requests_id_tenant_key unique (id, tenant_id),
  constraint leave_requests_range_check check (to_date >= from_date),
  constraint leave_requests_days_check check (days > 0),
  constraint leave_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint leave_requests_reason_check
    check (reason is null or char_length(reason) <= 500),
  constraint leave_requests_decision_check
    check ((decided_by is null) = (decided_at is null)),
  constraint leave_requests_staff_tenant_fkey
    foreign key (staff_id, tenant_id) references staff (id, tenant_id),
  constraint leave_requests_decided_by_tenant_fkey
    foreign key (decided_by, tenant_id) references staff (id, tenant_id),
  constraint leave_requests_type_tenant_fkey
    foreign key (leave_type_id, tenant_id) references leave_types (id, tenant_id)
);

create index leave_requests_tenant_staff_from_idx
  on leave_requests (tenant_id, staff_id, from_date);
create index leave_requests_tenant_status_idx
  on leave_requests (tenant_id, status);

alter table leave_types enable row level security;
alter table leave_types force row level security;

create policy tenant_isolation on leave_types
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy platform_admin_write on leave_types
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on leave_types to app_user;

alter table leave_requests enable row level security;
alter table leave_requests force row level security;

create policy tenant_isolation on leave_requests
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on leave_requests to app_user;

-- Seed the defaults for existing tenants. Idempotent by (tenant_id,
-- name): re-running is a no-op. New tenants get the same three rows
-- from seedDefaultLeaveTypes() inside the provisioning transaction.
insert into leave_types (id, tenant_id, name, annual_quota, is_paid)
select gen_random_uuid(), t.id, v.name, v.annual_quota, v.is_paid
from tenants t
cross join (
  values
    ('Casual', 12, true),
    ('Sick', 8, true),
    ('Unpaid', null, false)
) as v(name, annual_quota, is_paid)
where not exists (
  select 1 from leave_types lt
  where lt.tenant_id = t.id and lt.name = v.name
);
