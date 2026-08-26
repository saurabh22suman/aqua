create table roles (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  key         text not null,
  name        text not null,
  is_system   boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique (tenant_id, key),
  unique (id, tenant_id)
);

create index on roles (tenant_id) where deleted_at is null;

alter table roles enable row level security;
alter table roles force row level security;

create policy tenant_isolation on roles
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table role_permissions (
  tenant_id      uuid not null references tenants(id),
  role_id        uuid not null,
  permission_key text not null references permissions(key),
  granted_by     uuid,
  granted_at     timestamptz not null default now(),
  primary key (tenant_id, role_id, permission_key),
  foreign key (role_id, tenant_id)
    references roles (id, tenant_id) on delete cascade
);

alter table role_permissions enable row level security;
alter table role_permissions force row level security;

create policy tenant_isolation on role_permissions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
