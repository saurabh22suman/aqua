-- Known-good sibling for the tenant-conventions fixture: tenant-first
-- index, platform-table index, an audited pre-tenant exemption and no
-- database-side id default. Parsed, never executed.
create table widget_things (
  id uuid primary key,
  tenant_id uuid not null,
  widget_id uuid not null
);

create index widget_things_tenant_widget_idx
  on widget_things (tenant_id, widget_id);

-- Platform allowlist (db/allowlist.ts): no tenant scope to lead with.
create index ba_session_user_idx on ba_session (user_id);

-- Audited pre-tenant exemption (H-01): the resolver has no tenant yet.
create index tenant_memberships_user_live_idx
  on tenant_memberships (user_id)
  where deleted_at is null and status = 'active';
