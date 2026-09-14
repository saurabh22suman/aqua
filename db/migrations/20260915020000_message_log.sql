-- C-40a (payment/messaging decision, 2026-09-14) — the metered message
-- log, written by both providers. Mock-only for now; the WhatsApp Cloud
-- API adapter writes the same shape when it lands.

create table message_log (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  direction           text not null
                      check (direction in ('outbound', 'inbound')),
  provider            text not null
                      check (provider in ('mock', 'cloud')),
  provider_message_id text,
  to_phone            text,
  from_phone          text,
  template_key        text,
  body                text,
  status              text not null
                      check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error               text,
  category            text not null default 'utility'
                      check (category in ('utility', 'marketing', 'service', 'authentication')),
  cost_paise          bigint not null default 0 check (cost_paise >= 0),
  currency            text not null default 'INR',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index message_log_tenant_idx
  on message_log (tenant_id, created_at desc);

create index message_log_direction_idx
  on message_log (direction, created_at desc);

alter table message_log enable row level security;
alter table message_log force row level security;

create policy tenant_isolation on message_log
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on message_log
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on message_log
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on message_log to app_user;
