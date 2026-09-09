-- invite_link_uses: single-use consumption records for staff
-- magic-link login (invite + re-login links, lib/services/invite-link.ts).
--
-- Why a table instead of reusing membership status: flipping
-- invited -> active consumes an *invite* link for free (the status
-- column is the record), but a *re-login* link targets an already-
-- active membership where no status transition exists. One uniform
-- mechanism for both purposes, and an auditable trail of which
-- membership consumed which link when. The F-14 TODO (tenant-side
-- audit_log for security-relevant transitions) still stands; this
-- table is correctness state (single-use enforcement), not audit.
--
-- Consume = insert the jti. The primary key makes double-redeem
-- race-safe: the loser's insert fails on conflict and the redeem
-- is refused, with no check-then-insert window.

create table invite_link_uses (
  jti           text primary key,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  purpose       text not null,
  used_at       timestamptz not null default now(),
  constraint invite_link_uses_purpose_check
    check (purpose in ('invite', 'relogin'))
);

create index invite_link_uses_membership_idx
  on invite_link_uses (tenant_id, membership_id, used_at desc);

alter table invite_link_uses enable row level security;
alter table invite_link_uses force row level security;
create policy invite_link_uses_tenant_isolation
  on invite_link_uses
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant insert, update, delete, select on invite_link_uses to app_user;
