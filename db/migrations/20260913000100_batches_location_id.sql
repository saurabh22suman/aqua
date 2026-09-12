-- Wave 2 (docs/role-surfaces-plan.md) — batches.location_id.
--
-- Owner decision: nullable FK, backfilled to each tenant's primary
-- location (falling back to the oldest live location). New batches
-- are written with a facility by the form; the service falls back to
-- the primary location when a caller omits it. Sessions inherit the
-- facility through their batch, which is what makes per-facility
-- registers, schedules and attendance honest.
--
-- Nullable on purpose: existing tenant-wide batches (created before
-- this column) are backfilled, but a future tenant that genuinely runs
-- tenant-wide sessions is not forced to pick a facility at the schema
-- level. The composite FK mirrors every other tenant join table: a
-- batch can never reference another tenant's location.

alter table batches add column location_id uuid;

update batches b
   set location_id = (
     select l.id
       from locations l
      where l.tenant_id = b.tenant_id
        and l.deleted_at is null
      order by l.is_primary desc, l.created_at asc
      limit 1
   );

alter table batches
  add constraint batches_location_tenant_fkey
  foreign key (location_id, tenant_id)
  references locations (id, tenant_id);

create index batches_tenant_location_live_idx
  on batches (tenant_id, location_id)
  where deleted_at is null;
