-- C-29 (membership plans) — the priced, sellable plan a tenant actually
-- offers. Preset `plan_shapes` stay templates with amount_paise NULL;
-- activating one creates a membership_plans row that references it, and
-- subscriptions (C-30) reference the plan.
--
-- amount_paise is NOT NULL and > 0: a plan without a price cannot be
-- sold. tax_rate_bp defaults to 1800 (18% GST) and is stored even
-- though invoices (C-32) are what will apply it.

create table membership_plans (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  name             text not null,
  kind             text not null check (kind in ('duration', 'sessions', 'one_time')),
  duration_days    integer,
  sessions         integer,
  amount_paise     bigint not null check (amount_paise > 0),
  tax_rate_bp      integer not null default 1800
                   check (tax_rate_bp between 0 and 10000),
  -- The preset template this plan was activated from, when it was.
  -- SET NULL so wiping sample shapes (removeSampleData) leaves the
  -- sold plan intact.
  source_shape_id  uuid references plan_shapes(id) on delete set null,
  is_active        boolean not null default true,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint membership_plans_kind_payload_check check (
    (kind = 'duration'
      and duration_days is not null
      and duration_days > 0
      and sessions is null)
    or
    (kind = 'sessions'
      and sessions is not null
      and sessions > 0
      and duration_days is null)
    or
    (kind = 'one_time'
      and duration_days is null
      and sessions is null)
  ),
  constraint membership_plans_name_check
    check (char_length(name) between 1 and 120),
  constraint membership_plans_id_tenant_key unique (id, tenant_id)
);

-- One live plan per preset shape: activating twice is an edit, not a
-- second plan.
create unique index membership_plans_shape_live_uidx
  on membership_plans (tenant_id, source_shape_id)
  where deleted_at is null and source_shape_id is not null;

create index membership_plans_tenant_live_idx
  on membership_plans (tenant_id, is_active, name)
  where deleted_at is null;

alter table membership_plans enable row level security;
alter table membership_plans force row level security;

create policy tenant_isolation on membership_plans
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on membership_plans
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on membership_plans
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on membership_plans to app_user;
