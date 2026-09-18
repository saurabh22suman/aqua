-- Known-bad fixture for scripts/check-tenant-conventions.ts. Parsed
-- by the scan, never executed by the database. One v4 id default and
-- one index on a tenant table that does not lead with tenant_id.
create table widget_things (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  widget_id uuid not null
);

create index widget_things_widget_idx on widget_things (widget_id);
