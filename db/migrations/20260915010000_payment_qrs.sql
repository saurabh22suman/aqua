-- C-35 (payment gateway decision, 2026-09-14) — owner payment QRs.
--
-- Owners collect over their own UPI QR codes; the app stores and
-- displays them rather than integrating a payment gateway. Two kinds:
-- a UPI QR generated in-app from `upi_id` + `payee_name`, and an
-- uploaded image QR (a bank or merchant screenshot).
--
-- Images are stored in Postgres: the repo has no object store yet
-- (F-17's R2 setup is still pending), QRs are small, and a strict
-- size/mime cap keeps the column safe. `kind` is immutable — changing
-- a QR's type is a delete + create.

create table payment_qrs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  nickname    text not null,
  kind        text not null check (kind in ('upi', 'image')),
  upi_id      text,
  payee_name  text,
  image_data  bytea,
  image_mime  text,
  image_size  integer,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint payment_qrs_kind_payload_check check (
    (kind = 'upi'
      and upi_id is not null
      and payee_name is not null
      and image_data is null)
    or
    (kind = 'image'
      and image_data is not null
      and image_mime is not null
      and upi_id is null
      and payee_name is null)
  ),
  constraint payment_qrs_nickname_check
    check (char_length(nickname) between 1 and 60),
  constraint payment_qrs_image_size_check
    check (image_size is null or (image_size >= 1 and image_size <= 262144))
);

-- One live nickname per tenant, case-insensitive: the collect screen
-- identifies a QR by nickname, so duplicates would be ambiguous.
create unique index payment_qrs_tenant_nickname_live_uidx
  on payment_qrs (tenant_id, lower(nickname))
  where deleted_at is null;

create index payment_qrs_tenant_live_idx
  on payment_qrs (tenant_id, sort_order, created_at)
  where deleted_at is null;

alter table payment_qrs enable row level security;
alter table payment_qrs force row level security;

create policy tenant_isolation on payment_qrs
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on payment_qrs
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on payment_qrs
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on payment_qrs to app_user;
