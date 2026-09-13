-- O-02 (docs/ops-platform-design.md §8) — every event carries a location.
--
-- A session copies its batch's location at generation time; an
-- attendance mark copies its session's. That is what makes the
-- consolidated view (no location filter) and the per-site view
-- (filtered) the same query shape.
--
-- Nullable on purpose, matching batches.location_id's own precedent
-- (migration 20260913000100): a tenant-wide batch produces tenant-wide
-- sessions, and the value must stay meaningful rather than being
-- guessed at the primary location during backfill. Every session
-- written through the normal paths after O-01 has a batch with a
-- location, so the null case is legacy or deliberately tenant-wide.
--
-- No cascade on the location FK: history must block a hard delete of a
-- location that has events, unlike facilities which cannot exist
-- without a site.

alter table sessions add column location_id uuid;

update sessions s
   set location_id = b.location_id
  from batches b
 where b.id = s.batch_id
   and b.tenant_id = s.tenant_id;

alter table sessions
  add constraint sessions_location_tenant_fkey
  foreign key (location_id, tenant_id) references locations (id, tenant_id);

create index sessions_tenant_location_idx
  on sessions (tenant_id, location_id);

alter table attendance add column location_id uuid;

update attendance a
   set location_id = s.location_id
  from sessions s
 where s.id = a.session_id
   and s.tenant_id = a.tenant_id;

alter table attendance
  add constraint attendance_location_tenant_fkey
  foreign key (location_id, tenant_id) references locations (id, tenant_id);

create index attendance_tenant_location_idx
  on attendance (tenant_id, location_id);
