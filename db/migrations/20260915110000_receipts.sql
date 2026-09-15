-- C-39 (receipts) — the branded acknowledgment stored per payment.
--
-- Generated lazily on first read (get-or-create) rather than inside
-- the payment transaction: a PDF bug must never block money from
-- being recorded. The unique (tenant_id, payment_id) makes generation
-- idempotent — a duplicate download never produces a second document,
-- which is what C-48's "no duplicate receipts" verification depends
-- on.
--
-- The document carries the tenant's mark (initials on the tenant's
-- accent) and the GST-relevant references from the invoice: number,
-- GSTIN, SAC. Stored in Postgres because there is no object store yet
-- (same reasoning as payment_qrs.image_data).

create table receipts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  payment_id  uuid not null,
  pdf_data    bytea not null,
  pdf_size    integer not null check (pdf_size > 0),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint receipts_id_tenant_key unique (id, tenant_id),
  constraint receipts_payment_tenant_key unique (tenant_id, payment_id),
  constraint receipts_payment_tenant_fkey
    foreign key (payment_id, tenant_id) references payments (id, tenant_id)
);

alter table receipts enable row level security;
alter table receipts force row level security;

create policy tenant_isolation on receipts
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on receipts
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on receipts
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on receipts to app_user;
