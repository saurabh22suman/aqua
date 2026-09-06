-- audit_log
--
-- Tenant-side audit trail (architecture.md §8.10). The standing rule:
-- every mutation writes an audit row in the same transaction. F-14
-- was the deferred task to build the table itself; this migration
-- lands the schema that closes that gap, and parent-link issuance
-- (C-45, J4 audit) is the first caller.
--
-- Why bigserial and not uuid: this table grows fastest and is queried
-- least (architecture.md §8.1 carve-out for time-partitioned,
-- append-only tables never targeted by foreign keys). bigserial is
-- index-friendly and lets the table be range-partitioned by id later
-- (partition by month — see architecture.md §8.10's deferred
-- partitioning note).
--
-- `actor_id` is the `users.id` of the person performing the action
-- (the same id Ctx carries — every authenticated tenant caller has
-- a `users` row). The corresponding `staff.id` (when one exists)
-- is denormalised into the `after` JSONB so investigators don't have
-- to join through `staff.user_id` for the common case. `entity_id`
-- is the row the action targeted; the type is the convention
-- `entity_type` carries. `before`/`after` are JSONB snapshots when
-- the action mutated a row; `parent_link.issue` is the first caller
-- and writes only `after` — never a token, only member_id +
-- staff_id + issuedAt + expiresAt + scope.
--
-- `tenant_id` is NOT NULL on this table — every row must be
-- tenant-scoped. The platform_audit_log analogue covers the
-- platform-side cases (architecture.md §8.10's sibling paragraph).
--
-- RLS: strict tenant isolation (FORCE row level security), same
-- nullif pattern as every other tenant table — see migration 0004
-- for why. The policy is the same shape as members.tenant_isolation:
-- reads see only this tenant's rows; writes require the same.

create table audit_log (
  id          bigserial primary key,
  tenant_id   uuid not null,
  actor_id    uuid not null references users(id),
  action      text not null,        -- e.g. 'parent_link.issue'
  entity_type text not null,        -- e.g. 'parent_link'
  entity_id   uuid,                 -- e.g. the member id for parent_link.issue
  before      jsonb,
  after       jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index audit_log_tenant_id_created_at_idx on audit_log (tenant_id, created_at desc);
create index audit_log_tenant_id_entity_idx on audit_log (tenant_id, entity_type, entity_id);

alter table audit_log enable row level security;
alter table audit_log force row level security;

create policy tenant_isolation on audit_log
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only: app_user gets INSERT only. Reads go through the
-- service layer which runs inside withTenant(); updates and deletes
-- are not a supported operation. If a future need ever requires
-- deletion, it lands as its own migration with its own rationale.
grant insert on audit_log to app_user;
grant usage on sequence audit_log_id_seq to app_user;
