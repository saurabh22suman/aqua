-- Phase R.5 — waitlist_entries. A member joins a queue for a
-- full batch; on a slot opening (transfer / cancellation /
-- late-create drop), the head of the queue is auto-enrolled.
-- Status is a closed enum at the schema level:
--   waiting | promoted | cancelled | expired
--
-- The unique partial on (member, batch) where status='waiting'
-- enforces one open waitlist row per member per batch — a member
-- who has already been promoted can join the waitlist again
-- after cancelling the previous promotion, but cannot have two
-- open rows on the same batch.

create table waitlist_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  member_id       uuid not null,
  batch_id        uuid not null,
  status          text not null default 'waiting',
  -- position in the queue, 1-based. The first entry has position=1
  -- (FIFO). Updated when earlier rows cancel/expire.
  position        integer not null default 1,
  requested_at    timestamptz not null default now(),
  promoted_at     timestamptz,
  cancelled_at    timestamptz,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint waitlist_entries_status_check
    check (status in ('waiting', 'promoted', 'cancelled', 'expired')),
  constraint waitlist_entries_position_check
    check (position >= 1)
);

create unique index waitlist_entries_open_per_batch_idx
  on waitlist_entries (tenant_id, member_id, batch_id)
  where status = 'waiting';

create index waitlist_entries_batch_queue_idx
  on waitlist_entries (tenant_id, batch_id, position)
  where status = 'waiting';

alter table waitlist_entries enable row level security;
alter table waitlist_entries force row level security;
create policy waitlist_entries_tenant_isolation
  on waitlist_entries
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant insert, update, delete, select on waitlist_entries to app_user;
-- gate-reports-verify: trivial change to trigger agent-protected-paths workflow
