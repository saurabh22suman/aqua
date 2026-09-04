-- Phase R.7 — V.18 makeup_credits. Excused absences (an
-- attendance row with status='absent' that the owner has
-- marked as excused) can be redeemed against another batch.
-- Each grant creates a row; each redemption flips status to
-- 'redeemed' and pins redeemed_session_id. One free session
-- per source absence, no fee credit, no subscription
-- adjustment — the work guide's "do not let this drift into
-- a fee credit" is enforced at the data-model level (no
-- money columns, no subscription linkage).
--
-- RLS pattern matches the rest of tenant-scoped tables:
-- withTenant() / withUser() own writes, RLS policy
-- 'tenant_isolation' on the read path. Indexes lead with
-- tenant_id, with a partial index on (member_id) for the
-- "list outstanding credits for this member" surface.

create table makeup_credits (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  member_id       uuid not null,
  source_session_id uuid not null,
  -- granted via the attendance row's status update on the
  -- source session, not via a direct member_id FK; the
  -- member_id here is a soft reference to the (member_id,
  -- tenant_id) pair.
  status          text not null default 'granted',
  -- redeemed_session_id is null until the credit is used
  -- against another session.
  redeemed_session_id uuid,
  granted_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  redeemed_at     timestamptz,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint makeup_credits_status_check
    check (status in ('granted', 'redeemed', 'expired')),
  -- A given source absence can only yield one credit. The
  -- member_id + source_session_id tuple is the natural key.
  constraint makeup_credits_member_source_key
    unique (tenant_id, member_id, source_session_id)
);

create index makeup_credits_tenant_status_idx
  on makeup_credits (tenant_id, status)
  where status = 'granted';
create index makeup_credits_member_outstanding_idx
  on makeup_credits (tenant_id, member_id)
  where status = 'granted';

-- RLS — same shape as the rest of the tenant-scoped tables.
alter table makeup_credits enable row level security;
alter table makeup_credits force row level security;
create policy makeup_credits_tenant_isolation
  on makeup_credits
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant insert, update, delete, select on makeup_credits to app_user;
