-- 20260918101000_k02_orders
--
-- K-02 (Release 1 café module) — counter orders and their lines, per
-- implementation-plan.md K-02. The order is the operational record;
-- the invoice it bills into (K-03) is the legal document.
--
-- Shape decisions:
--   * `id` is UUIDv7 generated app-side (H-02 convention).
--   * `member_id` is nullable: a walk-in order records without a
--     member. The invoice spine needs a member, so finalize refuses a
--     walk-in until the member is added — see lib/services/orders.ts.
--   * `order_lines.item_id` is deliberately a soft reference (no FK):
--     the row is a snapshot of what was sold (name, unit price, tax
--     rate, SAC) and must survive any later menu edit, including an
--     archive. The DB additionally enforces line_paise = unit × qty.
--   * `counter_client_id` is reserved for the Phase 5 offline POS and
--     is unused in Release 1 — no offline mode ships here.
--   * 1:1 to the invoice: a partial unique index on
--     (tenant_id, invoice_id) where invoice_id is not null, so an
--     order cannot be billed twice.
--   * RLS: enable + force, standard nullif policy, full app_user DML
--     (the E-05 shape, minus append-only).

create table orders (
  id                uuid not null,         -- UUIDv7, generated app-side
  tenant_id         uuid not null references tenants(id) on delete cascade,
  location_id       uuid not null,
  member_id         uuid,
  status            text not null default 'placed'
                    check (status in ('placed', 'served', 'billed', 'voided')),
  channel           text not null default 'counter'
                    check (channel in ('counter')),
  served_by         uuid references users(id),
  invoice_id        uuid,
  counter_client_id text,                  -- reserved for the Phase 5 offline POS
  void_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  constraint orders_void_reason_check
    check (void_reason is null or char_length(void_reason) between 1 and 300),
  constraint orders_id_tenant_key unique (id, tenant_id),
  constraint orders_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id),
  constraint orders_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id),
  constraint orders_invoice_tenant_fkey
    foreign key (invoice_id, tenant_id) references invoices (id, tenant_id)
);

create unique index orders_tenant_invoice_uidx
  on orders (tenant_id, invoice_id)
  where invoice_id is not null;

create index orders_tenant_location_status_idx
  on orders (tenant_id, location_id, status, created_at desc);

create index orders_tenant_member_idx
  on orders (tenant_id, member_id);

alter table orders enable row level security;
alter table orders force row level security;

create policy tenant_isolation on orders
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on orders to app_user;

create table order_lines (
  id               uuid not null,          -- UUIDv7, generated app-side
  tenant_id        uuid not null references tenants(id) on delete cascade,
  order_id         uuid not null,
  item_id          uuid not null,          -- soft reference: snapshot survives menu edits
  item_name        text not null,
  qty              integer not null,
  unit_price_paise bigint not null,
  tax_rate_bp      integer not null,
  sac_code         text not null,
  line_paise       bigint not null,
  tax_paise        bigint not null,
  constraint order_lines_item_name_check
    check (char_length(item_name) between 1 and 300),
  constraint order_lines_qty_check check (qty > 0),
  constraint order_lines_unit_price_check check (unit_price_paise >= 0),
  constraint order_lines_tax_rate_check
    check (tax_rate_bp between 0 and 10000),
  constraint order_lines_sac_check check (sac_code ~ '^\d{4,8}$'),
  constraint order_lines_line_check check (line_paise >= 0),
  constraint order_lines_tax_check check (tax_paise >= 0),
  constraint order_lines_line_total_check
    check (line_paise = unit_price_paise * qty),
  constraint order_lines_id_tenant_key unique (id, tenant_id),
  constraint order_lines_order_tenant_fkey
    foreign key (order_id, tenant_id) references orders (id, tenant_id)
    on delete cascade
);

create index order_lines_tenant_order_idx
  on order_lines (tenant_id, order_id);

alter table order_lines enable row level security;
alter table order_lines force row level security;

create policy tenant_isolation on order_lines
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on order_lines to app_user;
