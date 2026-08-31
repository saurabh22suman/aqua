-- C-04: staff records. persons is the single identity table -- one
-- person can be both a coach and a member (two rows in two different
-- tables, same person_id).
create table staff (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  person_id   uuid not null,
  user_id     uuid references users(id),
  staff_type  text not null,
  employed_on date,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  check (staff_type in ('coach', 'receptionist', 'worker', 'accountant')),
  foreign key (person_id, tenant_id) references persons (id, tenant_id)
);

create unique index staff_id_tenant_key on staff (id, tenant_id);
create unique index staff_tenant_person_type_key
  on staff (tenant_id, person_id, staff_type)
  where deleted_at is null;
create index on staff (tenant_id) where deleted_at is null;

alter table staff enable row level security;
alter table staff force row level security;

create policy tenant_isolation on staff
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- batches.coach_id / sessions.coach_id have been a bare user id with no
-- FK since migration 0014, documented there as an interim shape because
-- staff didn't exist yet. It now does -- give both a real FK to staff.
--
-- Backfill is necessarily best-effort: the only way to reconstruct which
-- staff row a bare user id used to mean is users.person_id (set when a
-- user has a linked person in this tenant). Where that link doesn't
-- exist -- true of every environment seeded before this migration,
-- since nothing ever set it -- the column becomes null rather than
-- guessing. coach_id was already nullable; a null after this migration
-- is an honest "unknown", not a new failure mode. gen_random_uuid(): see
-- migration 0010's comment, same accepted exception.
insert into staff (id, tenant_id, person_id, user_id, staff_type)
select distinct gen_random_uuid(), d.tenant_id, u.person_id, d.coach_id, 'coach'
from (
  select tenant_id, coach_id from batches where coach_id is not null
  union
  select tenant_id, coach_id from sessions where coach_id is not null
) d
join users u on u.id = d.coach_id
where u.person_id is not null
on conflict (tenant_id, person_id, staff_type) where deleted_at is null do nothing;

alter table batches add column coach_staff_id uuid;
alter table sessions add column coach_staff_id uuid;

update batches b
set coach_staff_id = s.id
from staff s, users u
where u.id = b.coach_id
  and s.tenant_id = b.tenant_id and s.person_id = u.person_id and s.staff_type = 'coach';

update sessions se
set coach_staff_id = s.id
from staff s, users u
where u.id = se.coach_id
  and s.tenant_id = se.tenant_id and s.person_id = u.person_id and s.staff_type = 'coach';

alter table batches drop column coach_id;
alter table sessions drop column coach_id;
alter table batches rename column coach_staff_id to coach_id;
alter table sessions rename column coach_staff_id to coach_id;

alter table batches
  add constraint batches_coach_tenant_fkey
  foreign key (coach_id, tenant_id) references staff (id, tenant_id);
alter table sessions
  add constraint sessions_coach_tenant_fkey
  foreign key (coach_id, tenant_id) references staff (id, tenant_id);
