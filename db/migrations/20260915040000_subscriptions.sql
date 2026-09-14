-- C-30 (subscriptions) — a member's plan over time. Follows
-- architecture §8.6: start/end dates, active|paused|expired|cancelled,
-- the pause window, and the auto_renew/mandate columns reserved for
-- Phase 3 recurring debit.
--
-- Pause semantics: pausing records paused_from (and optional
-- paused_until). Resuming extends ends_on by the elapsed paused days,
-- so a seven-day pause moves the end date by exactly seven days.
-- ends_on is inclusive: the last day the subscription covers.

create table subscriptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  member_id    uuid not null,
  plan_id      uuid not null,
  starts_on    date not null,
  ends_on      date not null,
  status       text not null default 'active'
               check (status in ('active', 'paused', 'expired', 'cancelled')),
  paused_from  date,
  paused_until date,
  auto_renew   boolean not null default false,
  -- Razorpay e-mandate reference (Phase 3); unused until then.
  mandate_id   text,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint subscriptions_dates_check check (ends_on >= starts_on),
  constraint subscriptions_paused_from_check
    check (status <> 'paused' or paused_from is not null),
  constraint subscriptions_paused_range_check
    check (paused_until is null or (paused_from is not null and paused_until >= paused_from)),
  constraint subscriptions_id_tenant_key unique (id, tenant_id),
  constraint subscriptions_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id),
  constraint subscriptions_plan_tenant_fkey
    foreign key (plan_id, tenant_id) references membership_plans (id, tenant_id)
);

create index subscriptions_tenant_ends_idx
  on subscriptions (tenant_id, ends_on)
  where status = 'active';

create index subscriptions_tenant_member_idx
  on subscriptions (tenant_id, member_id);

alter table subscriptions enable row level security;
alter table subscriptions force row level security;

create policy tenant_isolation on subscriptions
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on subscriptions
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on subscriptions
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on subscriptions to app_user;
