-- F01 — durable operation intents for counter payments and partial
-- reversals.
--
-- The live defect: a repeated partial cash payment and a repeated
-- partial reversal were both applied twice. A browser-local key was
-- rejected by the human because the counter's second device, a reload
-- or a cleared tab lost it, and with it the protection. This table is
-- the durable identity: it is committed BEFORE the financial effect, so
-- an attempt can be found on another browser/device by the same
-- authorised actor and recovered (or explicitly discarded) instead of
-- being silently repeated.
--
-- Protocol (see lib/services/payment-intents.ts and
-- lib/services/payment-intent-core.ts):
--   1. PREPARE writes a 'prepared' row in its own transaction. The row
--      is durable before any payment/reversal exists.
--   2. COMMIT locks that row, writes the payment/reversal, the invoice
--      update, the audit row and the notification, and sets
--      state='committed' + result_id + committed_at IN THE SAME
--      TRANSACTION. A crash rolls the whole effect back; a committed
--      row always has its effect, and a prepared row never does.
--   3. A prepared row is retried with the same key or cancelled by the
--      operator (state='cancelled', cancelled_at). There is NO expiry
--      and no automatic replacement key: a TTL that minted a new key
--      would reopen the duplicate-payment hole.
--
-- Binding: (tenant_id, idempotency_key) is unique; the actor, kind and
-- target are stored on the row. payload_fingerprint is a SHA-256 of the
-- COMPLETE request payload (version, kind, target, amount, method,
-- reference / reason), so a changed payload is refused while amounts,
-- references and reasons are not duplicated into this table. One
-- financial result can be named by at most one intent.
--
-- No backfill: this is a new table. Existing payments/reversals keep
-- their current behaviour and have no intent row (they predate F01).
create table payment_intents (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  actor_id uuid not null,
  kind text not null,
  idempotency_key uuid not null,
  invoice_id uuid,
  payment_id uuid,
  location_id uuid not null,
  payload_fingerprint text not null,
  observation_kind text not null default 'unchecked',
  observed_intent_id uuid,
  state text not null default 'prepared',
  result_id uuid,
  committed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint payment_intents_kind_check
    check (kind in ('payment', 'reversal')),
  constraint payment_intents_state_check
    check (state in ('prepared', 'committed', 'cancelled')),
  constraint payment_intents_target_check
    check (
      (kind = 'payment' and invoice_id is not null and payment_id is null)
      or
      (kind = 'reversal' and invoice_id is null and payment_id is not null)
    ),
  constraint payment_intents_fingerprint_check
    check (char_length(payload_fingerprint) = 64),
  constraint payment_intents_committed_check
    check (
      (state = 'committed' and result_id is not null and committed_at is not null)
      or
      (state <> 'committed' and result_id is null and committed_at is null)
    ),
  constraint payment_intents_cancelled_check
    check (
      (state = 'cancelled' and cancelled_at is not null)
      or
      (state <> 'cancelled' and cancelled_at is null)
    ),
  constraint payment_intents_observation_kind_check
    check (observation_kind in ('unchecked', 'none', 'committed')),
  constraint payment_intents_observation_check
    check (
      (observation_kind = 'committed' and observed_intent_id is not null)
      or
      (observation_kind in ('unchecked', 'none') and observed_intent_id is null)
    ),
  constraint payment_intents_id_tenant_key unique (id, tenant_id),
  constraint payment_intents_tenant_key_unique unique (tenant_id, idempotency_key),
  constraint payment_intents_invoice_tenant_fkey
    foreign key (invoice_id, tenant_id) references invoices (id, tenant_id)
    on delete cascade,
  constraint payment_intents_payment_tenant_fkey
    foreign key (payment_id, tenant_id) references payments (id, tenant_id)
    on delete cascade,
  constraint payment_intents_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations (id, tenant_id)
    on delete cascade
);

-- At most ONE unresolved attempt per actor and target. A second device
-- that mints a new key recovers the prepared attempt's key instead of
-- creating a parallel operation. Committed/cancelled rows do not
-- participate, so sequential legitimate payments/reversals are
-- unaffected.
create unique index payment_intents_tenant_actor_invoice_open_uidx
  on payment_intents (tenant_id, actor_id, invoice_id)
  where kind = 'payment' and state = 'prepared';
create unique index payment_intents_tenant_actor_payment_open_uidx
  on payment_intents (tenant_id, actor_id, payment_id)
  where kind = 'reversal' and state = 'prepared';

-- One financial row can be named by at most one intent — the backstop
-- against a replay ever minting a second result.
create unique index payment_intents_tenant_result_uidx
  on payment_intents (tenant_id, result_id)
  where result_id is not null;

create index payment_intents_tenant_target_idx
  on payment_intents (tenant_id, kind, invoice_id, payment_id, created_at desc);
create index payment_intents_tenant_actor_target_committed_idx
  on payment_intents (tenant_id, actor_id, kind, invoice_id, payment_id, committed_at desc)
  where state = 'committed';

-- Same isolation contract as payments / payment_reversals: the app role
-- sees only the tenant GUC, and the ops platform has its own read/write
-- policies. The isolation catch-all (tests/tier1/isolation.test.ts)
-- requires every tenant table to be enabled AND forced.
alter table payment_intents enable row level security;
alter table payment_intents force row level security;

create policy tenant_isolation on payment_intents
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on payment_intents
  for select to app_user
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on payment_intents
  for all to app_user
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');

-- Durable history: the app may INSERT the prepared row and UPDATE it
-- prepared -> committed/cancelled, but never DELETE it. The migration
-- grant is intentionally DELETE-free; the blanket/default bootstrap
-- grants would re-add DELETE, so the approved DELETE-only reconcile in
-- db/app-privileges.ts is the effective guard after db:deploy.
grant select, insert, update on payment_intents to app_user;
