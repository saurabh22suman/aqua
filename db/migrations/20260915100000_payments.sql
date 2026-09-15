-- C-33 (cash and manual payments) — money received at the counter.
--
-- The payment-gateway decision (2026-09-14) removed the Razorpay
-- adapter: owners collect over their own UPI QRs and reception records
-- the payment here. Method is cash | upi | bank_transfer; channel is
-- 'counter' today ('online' is reserved for a future hosted flow).
--
-- received_by is a platform user id (same bare-uuid shape as
-- attendance.marked_by) — the person at the desk. reference carries
-- the UPI UTR or bank transaction reference entered by reception;
-- never a card number.
--
-- India-specific: cash at the counter is a first-class path (a
-- meaningful share of collections in this market), and the daily cash
-- count (C-34) reconciles it. Amounts are integer paise.

create table payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  invoice_id   uuid,
  member_id    uuid not null,
  location_id  uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  method       text not null check (method in ('cash', 'upi', 'bank_transfer')),
  channel      text not null default 'counter'
               check (channel in ('counter', 'online')),
  received_at  timestamptz not null default now(),
  received_by  uuid,
  reference    text,
  status       text not null default 'captured'
               check (status in ('pending', 'captured', 'failed', 'refunded')),
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint payments_reference_check
    check (reference is null or char_length(reference) between 1 and 120),
  constraint payments_id_tenant_key unique (id, tenant_id),
  constraint payments_invoice_tenant_fkey
    foreign key (invoice_id, tenant_id) references invoices (id, tenant_id),
  constraint payments_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id),
  constraint payments_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id)
);

create index payments_tenant_received_idx
  on payments (tenant_id, received_at desc);

create index payments_tenant_invoice_idx
  on payments (tenant_id, invoice_id);

create index payments_tenant_member_idx
  on payments (tenant_id, member_id);

alter table payments enable row level security;
alter table payments force row level security;

create policy tenant_isolation on payments
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on payments
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on payments
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on payments to app_user;
