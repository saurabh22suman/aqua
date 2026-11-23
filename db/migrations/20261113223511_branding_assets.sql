-- Approved tenant-isolated current PNG storage. Image decoding/hash validation remains in the service.
create table public.branding_assets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('logo', 'install_icon')),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  png bytea not null check (
    octet_length(png) between 1 and 5242880
    and substring(png from 1 for 8) = decode('89504e470d0a1a0a', 'hex')
  ),
  created_at timestamptz not null default now(),
  primary key (tenant_id, kind)
);

alter table public.branding_assets enable row level security;
alter table public.branding_assets force row level security;
create policy tenant_isolation on public.branding_assets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, delete on public.branding_assets to app_user;
revoke update on public.branding_assets from app_user;
-- This revoke alone is NOT durable. db/app-privileges.ts must also execute:
-- do $$ begin if to_regclass('public.branding_assets') is not null then
--   revoke update on public.branding_assets from app_user;
-- end if; end $$;
-- DELETE remains granted for transactional replacement and bounded pruning.
-- App must lock the tenant row, delete the old kind, insert the newly
-- normalized PNG, update its reference and audit in the same transaction.
-- Each stored tenant_id references its own tenant; never add an RLS exemption.
