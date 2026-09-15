-- C-32 (invoices) — the document the academy issues to a member.
--
-- India-specific shape, per Rule 46 of the CGST Rules:
--   * invoice_number is the gapless per-financial-year series from
--     C-31 (INV/2026-27/0001). GST caps the serial number at 16
--     characters.
--   * gstin is the issuer's GSTIN snapshot at issue. A tenant without
--     a GSTIN issues a Bill of Supply, not a tax invoice — an
--     unregistered supplier cannot collect GST — and the service
--     charges no tax for that tenant. The presence of gstin is the
--     single switch for both.
--   * line items carry the SAC code (services — never HSN, which is
--     for goods) and the resolved GST rate snapshot, so a later
--     config change never rewrites an issued document.
--   * tax_paise is the full GST. CGST/SGST are the intra-state split
--     (one tenant = one GSTIN, supply at the supplier's location for
--     B2C services), derived at render time as equal halves with any
--     odd paise going to SGST. Inter-state (IGST) is not modelled —
--     see the C-32 PR note.
--
-- Prices are GST-exclusive (C-29b): subtotal + tax = total. Amounts
-- are integer paise throughout (architecture §8.6).

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  location_id     uuid not null,
  member_id       uuid not null,
  subscription_id uuid,
  invoice_number  text not null,
  financial_year  text not null check (financial_year ~ '^\d{4}-\d{2}$'),
  issued_on       date not null,
  due_on          date not null,
  subtotal_paise  bigint not null check (subtotal_paise >= 0),
  tax_paise       bigint not null check (tax_paise >= 0),
  total_paise     bigint not null check (total_paise > 0),
  paid_paise      bigint not null default 0 check (paid_paise >= 0),
  status          text not null
                  check (status in ('draft', 'issued', 'partial', 'paid', 'void')),
  -- Snapshot of tenants.gstin at issue. Null => Bill of Supply.
  gstin           text,
  notes           text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint invoices_number_check
    check (char_length(invoice_number) between 1 and 16),
  constraint invoices_totals_check
    check (subtotal_paise + tax_paise = total_paise),
  constraint invoices_paid_within_total_check
    check (paid_paise <= total_paise),
  constraint invoices_dates_check check (due_on >= issued_on),
  constraint invoices_id_tenant_key unique (id, tenant_id),
  constraint invoices_number_tenant_key
    unique (tenant_id, financial_year, invoice_number),
  constraint invoices_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id),
  constraint invoices_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id),
  constraint invoices_subscription_tenant_fkey
    foreign key (subscription_id, tenant_id) references subscriptions (id, tenant_id)
);

-- C-47 idempotency: a renewal raises at most one live invoice per
-- subscription per due date. Re-running invoices.generate is a no-op.
create unique index invoices_subscription_due_live_uidx
  on invoices (tenant_id, subscription_id, due_on)
  where subscription_id is not null and status <> 'void';

create index invoices_tenant_status_due_idx
  on invoices (tenant_id, status, due_on);

create index invoices_tenant_member_idx
  on invoices (tenant_id, member_id);

create index invoices_tenant_issued_idx
  on invoices (tenant_id, issued_on);

create table invoice_line_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  invoice_id    uuid not null,
  description   text not null,
  -- SAC (services). 4-8 digits; snapshot at issue.
  sac_code      text not null,
  amount_paise  bigint not null check (amount_paise > 0),
  tax_rate_bp   integer not null check (tax_rate_bp between 0 and 10000),
  tax_paise     bigint not null check (tax_paise >= 0),
  created_at    timestamptz not null default now(),
  constraint invoice_line_items_description_check
    check (char_length(description) between 1 and 300),
  constraint invoice_line_items_sac_check
    check (sac_code ~ '^\d{4,8}$'),
  constraint invoice_line_items_id_tenant_key unique (id, tenant_id),
  constraint invoice_line_items_invoice_tenant_fkey
    foreign key (invoice_id, tenant_id) references invoices (id, tenant_id)
    on delete cascade
);

create index invoice_line_items_invoice_idx
  on invoice_line_items (tenant_id, invoice_id);

alter table invoices enable row level security;
alter table invoices force row level security;

create policy tenant_isolation on invoices
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on invoices
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on invoices
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on invoices to app_user;

alter table invoice_line_items enable row level security;
alter table invoice_line_items force row level security;

create policy tenant_isolation on invoice_line_items
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on invoice_line_items
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on invoice_line_items
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on invoice_line_items to app_user;
