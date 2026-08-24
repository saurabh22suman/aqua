create table persons (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  full_name     text not null,
  date_of_birth date,
  gender        text,
  medical_notes text,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  unique (id, tenant_id)
);

create index on persons (tenant_id) where deleted_at is null;

alter table persons enable row level security;
alter table persons force row level security;

create policy tenant_isolation on persons
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table members (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  person_id   uuid not null,
  location_id uuid not null,
  member_code text not null,
  status      text not null default 'active'
              check (status in ('active', 'inactive', 'left')),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  foreign key (person_id, tenant_id)
    references persons (id, tenant_id),
  foreign key (location_id, tenant_id)
    references locations (id, tenant_id),
  unique (tenant_id, member_code),
  unique (id, tenant_id)
);

create index on members (tenant_id, location_id) where deleted_at is null;

alter table members enable row level security;
alter table members force row level security;

create policy tenant_isolation on members
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table programs (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  description text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique (id, tenant_id)
);

alter table programs enable row level security;
alter table programs force row level security;

create policy tenant_isolation on programs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table batches (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  program_id   uuid not null,
  name         text not null,
  capacity     int not null check (capacity > 0),
  days_of_week int[] not null default '{}',
  start_time   time not null,
  end_time     time not null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  foreign key (program_id, tenant_id)
    references programs (id, tenant_id),
  unique (id, tenant_id)
);

alter table batches enable row level security;
alter table batches force row level security;

create policy tenant_isolation on batches
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table enrolments (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  member_id   uuid not null,
  batch_id    uuid not null,
  enrolled_on date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  foreign key (member_id, tenant_id)
    references members (id, tenant_id),
  foreign key (batch_id, tenant_id)
    references batches (id, tenant_id),
  unique (tenant_id, member_id, batch_id, enrolled_on)
);

alter table enrolments enable row level security;
alter table enrolments force row level security;

create policy tenant_isolation on enrolments
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table sessions (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  batch_id     uuid not null,
  session_date date not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'held', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  foreign key (batch_id, tenant_id)
    references batches (id, tenant_id),
  unique (tenant_id, batch_id, session_date),
  unique (id, tenant_id)
);

create index on sessions (tenant_id, starts_at);

alter table sessions enable row level security;
alter table sessions force row level security;

create policy tenant_isolation on sessions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table attendance (
  id         uuid primary key,
  tenant_id  uuid not null references tenants(id),
  session_id uuid not null,
  member_id  uuid not null,
  status     text not null default 'present'
             check (status in ('present', 'absent', 'late')),
  client_id  text not null,
  marked_by  uuid,
  marked_at  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  foreign key (session_id, tenant_id)
    references sessions (id, tenant_id),
  foreign key (member_id, tenant_id)
    references members (id, tenant_id),
  unique (tenant_id, session_id, member_id),
  unique (tenant_id, client_id)
);

create index on attendance (tenant_id, session_id);

alter table attendance enable row level security;
alter table attendance force row level security;

create policy tenant_isolation on attendance
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
