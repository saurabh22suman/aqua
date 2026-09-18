-- 20260918100000_k01_menu
--
-- K-01 (Release 1 café module) — the menu catalog, per
-- implementation-plan.md K-01 and architecture.md §8.12. The café is
-- a module on the kernel: these tables hang off tenants/locations and
-- nothing else in the schema points at them except K-02's soft
-- `item_id` reference.
--
-- Shape decisions:
--   * `id` is UUIDv7 generated app-side — no `gen_random_uuid()`
--     default (H-02 convention; time-ordered and index-friendly).
--   * money is integer paise (`price_paise bigint > 0`); GST is basis
--     points (`tax_rate_bp` 0..10000, so 5% is 500); `sac_code` is
--     4–8 digits.
--   * soft delete only (`deleted_at`): an item that has been sold must
--     survive as a row for the order/invoice audit trail. Both name
--     uniqueness indexes are partial on `deleted_at is null` and
--     expression-based on `lower(name)`, so "Masala Chai" and
--     "masala chai" collide while live and a name is reusable only
--     after an archive.
--   * RLS: enable + force, the standard nullif tenant_isolation policy
--     on both tables; grants match the other Release 1 tables (the
--     E-05 shape, minus append-only): app_user gets full DML.

create table menu_categories (
  id          uuid not null,               -- UUIDv7, generated app-side
  tenant_id   uuid not null references tenants(id) on delete cascade,
  location_id uuid not null,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint menu_categories_name_check
    check (char_length(name) between 1 and 120),
  constraint menu_categories_id_tenant_key unique (id, tenant_id),
  constraint menu_categories_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id)
);

create unique index menu_categories_tenant_location_name_live_uidx
  on menu_categories (tenant_id, location_id, lower(name))
  where deleted_at is null;

create index menu_categories_tenant_location_live_idx
  on menu_categories (tenant_id, location_id, is_active, sort_order)
  where deleted_at is null;

alter table menu_categories enable row level security;
alter table menu_categories force row level security;

create policy tenant_isolation on menu_categories
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on menu_categories to app_user;

create table menu_items (
  id          uuid not null,               -- UUIDv7, generated app-side
  tenant_id   uuid not null references tenants(id) on delete cascade,
  location_id uuid not null,
  category_id uuid not null,
  name        text not null,
  price_paise bigint not null,
  tax_rate_bp integer not null default 0,
  sac_code    text not null,
  is_veg      boolean not null default true,
  is_active   boolean not null default true,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint menu_items_name_check
    check (char_length(name) between 1 and 120),
  constraint menu_items_price_check check (price_paise > 0),
  constraint menu_items_tax_rate_check
    check (tax_rate_bp between 0 and 10000),
  constraint menu_items_sac_check check (sac_code ~ '^\d{4,8}$'),
  constraint menu_items_id_tenant_key unique (id, tenant_id),
  constraint menu_items_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id),
  constraint menu_items_category_tenant_fkey
    foreign key (category_id, tenant_id)
    references menu_categories (id, tenant_id)
);

create unique index menu_items_tenant_location_name_live_uidx
  on menu_items (tenant_id, location_id, lower(name))
  where deleted_at is null;

create index menu_items_tenant_location_category_live_idx
  on menu_items (tenant_id, location_id, category_id)
  where deleted_at is null;

alter table menu_items enable row level security;
alter table menu_items force row level security;

create policy tenant_isolation on menu_items
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on menu_items to app_user;
