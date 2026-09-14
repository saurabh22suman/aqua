-- O-03 (docs/ops-platform-design.md §8) — preset applications bind to
-- a location, not a tenant.
--
-- The tenant columns stay: they are the owning-preset record for the
-- tenant-wide content (terminology, roles, skills, plan shapes,
-- templates, dashboard cards) under O-03's interim first-wins rule.
-- location_presets is the copy-on-apply record for location-bound
-- content and the per-location idempotence key — one row per location,
-- replaced on re-apply.
--
-- Backfill: every preset applied before this migration was applied
-- tenant-wide, which was effectively at the primary location.
-- Recording that keeps the location-level lock honest instead of
-- inviting a double apply on the next operator click.

create table location_presets (
  location_id    uuid primary key,
  tenant_id      uuid not null,
  preset_key     text not null,
  preset_version integer not null,
  applied_at     timestamptz not null default now(),
  applied_by     uuid,
  constraint location_presets_location_tenant_key
    unique (location_id, tenant_id),
  constraint location_presets_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id)
    on delete cascade,
  constraint location_presets_preset_fkey
    foreign key (preset_key, preset_version) references presets (key, version)
);

insert into location_presets (location_id, tenant_id, preset_key, preset_version, applied_at)
select l.id, l.tenant_id, t.preset_key, t.preset_version, t.preset_applied_at
  from locations l
  join tenants t on t.id = l.tenant_id
 where l.is_primary
   and l.deleted_at is null
   and t.preset_key is not null
on conflict (location_id) do nothing;

alter table location_presets enable row level security;
alter table location_presets force row level security;
create policy location_presets_tenant_isolation
  on location_presets
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));
create policy location_presets_platform_admin_select
  on location_presets
  for select
  using (current_setting('app.platform_admin', true) = 'true');
create policy location_presets_platform_admin_write
  on location_presets
  for all
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

grant select, insert, update, delete on location_presets to app_user;
