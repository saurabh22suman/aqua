-- O-07 (docs/ops-platform-design.md §4) — owner "Request change" for
-- registry keys the owner can read but not edit (owner_read).
--
-- A request is a tenant's ask, reviewed by ops: tenant_id + key +
-- requested value + note, with a resolved/declined outcome. It is
-- tenant-scoped and RLS-isolated like any tenant row; ops reads and
-- resolutions go through the platform_admin policies.

create table config_change_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  key             text not null references config_keys(key),
  -- Free text: a request is reviewed by a person, not applied by a
  -- machine, so it does not have to satisfy the key's value schema.
  requested_value text not null,
  note            text,
  status          text not null default 'requested'
                  check (status in ('requested', 'resolved', 'declined')),
  requested_by    uuid references users(id) on delete set null,
  resolved_by     uuid references platform_users(id) on delete set null,
  resolution_note text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index config_change_requests_tenant_idx
  on config_change_requests (tenant_id, status, created_at desc);

alter table config_change_requests enable row level security;
alter table config_change_requests force row level security;

create policy tenant_isolation on config_change_requests
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on config_change_requests
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on config_change_requests
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on config_change_requests to app_user;
