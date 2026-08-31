-- C-03/C-08: members.status widens from active|inactive|left to the
-- plan's full lifecycle -- trial|active|paused|lapsed|left. C-12-C-15
-- (enquiries -> trial -> conversion) cannot represent a trial member
-- without this. 'inactive' is dropped: it was never a distinct state
-- from 'lapsed' and nothing in the plan or existing code branches on
-- it (grep confirmed zero references outside this constraint).
alter table members drop constraint members_status_check;
alter table members add constraint members_status_check
  check (status in ('trial', 'active', 'paused', 'lapsed', 'left'));

-- Every status change, who made it, and why. Insert-only by
-- convention (transitionMemberStatus is the only writer; no code path
-- updates or deletes a row here) -- not given consents' trigger-
-- enforced immutability because a status-change log doesn't carry the
-- same DPDP evidentiary weight consents does. Scoped to this task
-- rather than building the generic F-14 audit_log (not yet built by
-- any prior task) -- see docs/implementation-plan.md C-08.
create table member_status_transitions (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  member_id   uuid not null,
  from_status text not null,
  to_status   text not null,
  reason      text,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  foreign key (member_id, tenant_id) references members (id, tenant_id)
);

create index on member_status_transitions (tenant_id, member_id, changed_at desc);

alter table member_status_transitions enable row level security;
alter table member_status_transitions force row level security;

create policy tenant_isolation on member_status_transitions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
