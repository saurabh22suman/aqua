create table plans (
  id          uuid primary key,
  key         text unique not null,
  name        text not null,
  status      text not null default 'active'
              check (status in ('active', 'deprecated')),
  price_paise bigint,
  currency    text not null default 'INR',
  is_default  boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- exactly one default plan, structurally enforced
create unique index plans_single_default on plans (is_default) where is_default;

create table features (
  key      text primary key,
  name     text not null,
  category text not null,
  status   text not null default 'ga'
           check (status in ('ga', 'beta', 'internal'))
);

create table plan_features (
  plan_id     uuid not null references plans(id) on delete cascade,
  feature_key text not null references features(key),
  limits      jsonb not null default '{}',
  primary key (plan_id, feature_key)
);

create table presets (
  key         text not null,
  version     int not null,
  name        text not null,
  description text not null,
  definition  jsonb not null,
  status      text not null default 'active'
              check (status in ('active', 'deprecated')),
  primary key (key, version)
);

create table permissions (
  key         text primary key,
  module      text not null,
  description text not null
);

alter table tenants
  add constraint tenants_plan_id_fkey
  foreign key (plan_id) references plans(id);
