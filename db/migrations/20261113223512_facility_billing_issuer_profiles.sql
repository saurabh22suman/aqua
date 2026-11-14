-- Approved physical-site issuer expansion; absent/disabled settings retain legacy behavior.
create table billing_registrations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  legal_name text not null check (btrim(legal_name) <> ''),
  legal_address jsonb not null check (jsonb_typeof(legal_address) = 'object'),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  gstin text not null check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and left(gstin, 2) = state_code),
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);

alter table billing_registrations enable row level security;
alter table billing_registrations force row level security;
create policy tenant_isolation on billing_registrations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert on billing_registrations to app_user;
revoke update, delete on billing_registrations from app_user;
-- Registration rows are immutable versions; corrections insert a new row.
-- REQUIRED companion in db/app-privileges.ts, after blanket bootstrap grants:
-- if to_regclass('public.billing_registrations') is not null then
--   revoke update, delete on public.billing_registrations from app_user;
-- end if;
-- A migration revoke alone is not durable across bootstrapRoles re-grants.
-- No RLS-exempt allowlist addition. Review role inheritance and retention.

-- Club default: tenants.gstin remains the single GSTIN source (null means
-- unregistered). These nullable fields are owner-supplied, not backfilled.
alter table tenants
  add column billing_legal_name text,
  add column billing_legal_address jsonb,
  add column billing_state_code text,
  add constraint tenants_billing_legal_name_check check
    (billing_legal_name is null or btrim(billing_legal_name) <> ''),
  add constraint tenants_billing_legal_address_check check
    (billing_legal_address is null or jsonb_typeof(billing_legal_address) = 'object'),
  add constraint tenants_billing_state_code_check check
    (billing_state_code is null or billing_state_code ~ '^[0-9]{2}$');
-- Application validates complete address, known state and GSTIN/state match
-- before enabling any site inheriting this default; incomplete draft allowed.

create table location_billing_settings (
  tenant_id uuid not null,
  location_id uuid not null,
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  facility_billing_enabled boolean not null default false,
  mode text not null check (mode in ('inherit', 'registered_override', 'unregistered_override')),
  registration_id uuid,
  unregistered_legal_name text,
  unregistered_legal_address jsonb,
  primary key (tenant_id, location_id),
  foreign key (location_id, tenant_id) references locations(id, tenant_id) on delete cascade,
  foreign key (registration_id, tenant_id) references billing_registrations(id, tenant_id),
  check ((mode = 'registered_override' and registration_id is not null)
      or (mode in ('inherit', 'unregistered_override') and registration_id is null)),
  check ((mode = 'unregistered_override' and unregistered_legal_name is not null
          and btrim(unregistered_legal_name) <> '' and unregistered_legal_address is not null
          and jsonb_typeof(unregistered_legal_address) = 'object')
      or (mode <> 'unregistered_override' and unregistered_legal_name is null
          and unregistered_legal_address is null))
);
alter table location_billing_settings enable row level security;
alter table location_billing_settings force row level security;
create policy tenant_isolation on location_billing_settings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on location_billing_settings to app_user;
-- No row, or enabled=false, uses the unchanged legacy path, regardless of
-- draft settings. Owner explicitly enables each site only after validating its
-- effective complete issuer, state match and absence of unbilled orders.
-- Application validates live location, authority and writes audit atomically.

alter table invoices
  add column issuer_snapshot_version smallint not null default 0,
  add column issuer_legal_name text,
  add column issuer_legal_address jsonb,
  add column issuer_state_code text,
  add column issuer_registration_mode text,
  add constraint invoices_issuer_snapshot_check check (
    issuer_snapshot_version = 0 or
    (issuer_snapshot_version = 1 and issuer_legal_name is not null and btrim(issuer_legal_name) <> ''
      and issuer_legal_address is not null and jsonb_typeof(issuer_legal_address) = 'object'
      and issuer_state_code is not null and issuer_state_code ~ '^[0-9]{2}$'
      and issuer_registration_mode is not null
      and ((issuer_registration_mode = 'registered' and gstin is not null and left(gstin, 2) = issuer_state_code)
        or (issuer_registration_mode = 'unregistered' and gstin is null)))
  );

alter table orders
  add column issuer_snapshot_version smallint not null default 0,
  add column issuer_legal_name text,
  add column issuer_legal_address jsonb,
  add column issuer_state_code text,
  add column issuer_gstin text,
  add column issuer_registration_mode text,
  add constraint orders_issuer_snapshot_check check (
    issuer_snapshot_version = 0 or
    (issuer_snapshot_version = 1 and issuer_legal_name is not null and btrim(issuer_legal_name) <> ''
      and issuer_legal_address is not null and jsonb_typeof(issuer_legal_address) = 'object'
      and issuer_state_code is not null and issuer_state_code ~ '^[0-9]{2}$'
      and issuer_registration_mode is not null
      and ((issuer_registration_mode = 'registered' and issuer_gstin is not null and left(issuer_gstin, 2) = issuer_state_code)
        or (issuer_registration_mode = 'unregistered' and issuer_gstin is null)))
  );

create function freeze_invoice_issuer_snapshot() returns trigger language plpgsql as $$
begin
  if old.issuer_snapshot_version = 1 and (
    new.issuer_snapshot_version is distinct from old.issuer_snapshot_version or
    new.issuer_legal_name is distinct from old.issuer_legal_name or
    new.issuer_legal_address is distinct from old.issuer_legal_address or
    new.issuer_state_code is distinct from old.issuer_state_code or
    new.issuer_registration_mode is distinct from old.issuer_registration_mode or
    new.gstin is distinct from old.gstin
  ) then raise exception 'issued invoice issuer snapshot is immutable' using errcode = '23514'; end if;
  return new;
end $$;
create trigger freeze_invoice_issuer_snapshot_trg before update on invoices
  for each row execute function freeze_invoice_issuer_snapshot();

create function freeze_order_issuer_snapshot() returns trigger language plpgsql as $$
begin
  if old.issuer_snapshot_version = 1 and (
    new.issuer_snapshot_version is distinct from old.issuer_snapshot_version or
    new.issuer_legal_name is distinct from old.issuer_legal_name or
    new.issuer_legal_address is distinct from old.issuer_legal_address or
    new.issuer_state_code is distinct from old.issuer_state_code or
    new.issuer_registration_mode is distinct from old.issuer_registration_mode or
    new.issuer_gstin is distinct from old.issuer_gstin
  ) then raise exception 'order issuer snapshot is immutable' using errcode = '23514'; end if;
  return new;
end $$;
create trigger freeze_order_issuer_snapshot_trg before update on orders
  for each row execute function freeze_order_issuer_snapshot();

-- A separate reviewed fail-closed insert guard must require version 1 for
-- enabled-site new invoices and orders while allowing version 0 for disabled
-- or absent settings. Guard and enablement must share the serialization
-- protocol; reject legacy writers for enabled sites, never globally. Legacy
-- orders are drained before enablement so no version-0 order crosses cutover.
-- Preserve existing payer/paid-status trigger rules and seed compatibility.
-- Application transactions must serialize order placement vs identity change;
-- DDL above alone does not enforce the unbilled-order gate.
