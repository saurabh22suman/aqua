create table tenants (
  id         uuid primary key,
  slug       text not null unique,
  name       text not null,
  status     text not null default 'trial'
             check (status in ('trial', 'active', 'suspended', 'churned')),
  plan_id    uuid,
  timezone   text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table tenants enable row level security;
alter table tenants force row level security;

create policy tenant_isolation on tenants
  using (id = current_setting('app.tenant_id', true)::uuid)
  with check (id = current_setting('app.tenant_id', true)::uuid);

create table locations (
  id         uuid primary key,
  tenant_id  uuid not null references tenants(id),
  name       text not null,
  is_primary boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (id, tenant_id)
);

create index on locations (tenant_id) where deleted_at is null;

alter table locations enable row level security;
alter table locations force row level security;

create policy tenant_isolation on locations
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create table users (
  id             uuid primary key,
  better_auth_id text unique,
  person_id      uuid,
  phone          text not null unique,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid
);

create table tenant_memberships (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  user_id       uuid not null references users(id),
  role          text not null
                check (role in ('owner', 'admin', 'coach', 'parent')),
                -- INTERIM: plain-text role only until F-04 lands the
                -- roles / permissions / role_permissions model. Do not
                -- build on this as the final design.
  all_locations boolean not null default true,
  status        text not null default 'invited'
                check (status in ('invited', 'active', 'revoked')),
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  unique (tenant_id, user_id),
  unique (id, tenant_id)
);

alter table tenant_memberships enable row level security;
alter table tenant_memberships force row level security;

create policy tenant_isolation on tenant_memberships
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create table membership_locations (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  membership_id uuid not null,
  location_id   uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  foreign key (membership_id, tenant_id)
    references tenant_memberships (id, tenant_id) on delete cascade,
  foreign key (location_id, tenant_id)
    references locations (id, tenant_id),
  unique (tenant_id, membership_id, location_id)
);

alter table membership_locations enable row level security;
alter table membership_locations force row level security;

create policy tenant_isolation on membership_locations
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
