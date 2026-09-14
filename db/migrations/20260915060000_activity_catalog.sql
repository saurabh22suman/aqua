-- Activity catalog (decision 2026-09-14) — activities are what the
-- schema calls `facilities`: a pool, court, table, café counter, under
-- a location (the product word for a site/facility). Until now these
-- rows existed only as preset seeds; with per-activity plans and GST
-- coming, owners and ops need to manage them.
--
-- Changes:
--   1. kind set gains 'table' (billiards / table tennis).
--   2. deleted_at: soft delete, so an activity referenced by a plan or
--      subscription can be retired without breaking history.
--   3. Live-name uniqueness per location and live-name uniqueness per
--      activity for sub-units (tables, lanes).

alter table facilities add column deleted_at timestamptz;
alter table facility_sub_units add column deleted_at timestamptz;

alter table facilities drop constraint facilities_kind_check;
alter table facilities
  add constraint facilities_kind_check
  check (kind in ('pool', 'court', 'turf', 'studio', 'field', 'counter', 'table'));

create unique index facilities_tenant_location_name_live_uidx
  on facilities (tenant_id, location_id, lower(name))
  where deleted_at is null;

create index facilities_tenant_location_live_idx
  on facilities (tenant_id, location_id)
  where deleted_at is null;

create unique index facility_sub_units_name_live_uidx
  on facility_sub_units (tenant_id, facility_id, lower(name))
  where deleted_at is null;

grant select, insert, update, delete on facility_sub_units to app_user;
