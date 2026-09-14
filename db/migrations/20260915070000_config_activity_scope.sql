-- 2026-09-14 — configuration values gain an activity scope.
--
-- Plans price per activity and GST can differ per activity inside one
-- facility (café food vs sports), so the resolver's fixed order becomes
-- platform -> plan -> preset -> tenant -> location -> activity. The
-- scope_id is a facilities.id (the "activity" row) and tenant_id still
-- carries the owning tenant for RLS.

alter table config_values drop constraint config_values_scope_type_check;
alter table config_values
  add constraint config_values_scope_type_check
  check (scope_type in ('platform', 'plan', 'preset', 'tenant', 'location', 'activity'));
