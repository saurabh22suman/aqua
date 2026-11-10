-- F01 durable-intent hardening (M-03 / M-04) — PROPOSAL, NOT APPLIED.
--
-- Forward-only from db/migrations/20261029121000_payment_intents.sql (already
-- applied; never edited). Target file after approval:
--   db/migrations/20261030120000_payment_intent_hardening.sql
--
-- M-03 — a financial target delete must not erase durable intent history.
--   The three target FKs move from ON DELETE CASCADE to ON DELETE RESTRICT,
--   so an app-role (or privileged) delete of a referenced invoice, payment or
--   location is refused (23503) instead of silently cascading the intent row
--   away and bypassing the DELETE revoke on payment_intents.
--   Consequence: a privileged teardown must delete the intent rows BEFORE the
--   financial targets. That is the order the repository already uses
--   (tests/.../f01-durable-recovery.seams.test.ts and the other tenant
--   teardowns); it is covered by the agent-owned regression P6a/P6b.
--
-- M-04 — the intent row is append-only except for the two real producers:
--   prepared -> committed  (lib/services/payment-intent-core.ts markIntentCommitted)
--   prepared -> cancelled  (lib/services/payment-intent-core.ts markIntentCancelled)
--   Identity, payload fingerprint, observed-intent chain and the final marker
--   are frozen. Audit metadata (updated_at / updated_by) may change on the
--   transition. Every other UPDATE is refused (23514), including a rewrite of
--   a terminal row and a raw audit-only UPDATE of a prepared row.
--
-- The tenant FK keeps its EXISTING policy (on delete cascade). No erasure
-- product is added here and no retention decision is taken by this migration.
--
-- The app role keeps its table-wide UPDATE grant: the trigger, not a column
-- grant, is the enforcement (a column grant cannot express "only
-- prepared -> committed|cancelled" nor "terminal rows are immutable").

begin;

-- 1. M-03 — the three target FKs: cascade -> restrict.
alter table payment_intents drop constraint payment_intents_invoice_tenant_fkey;
alter table payment_intents add constraint payment_intents_invoice_tenant_fkey
  foreign key (invoice_id, tenant_id) references invoices (id, tenant_id)
  on delete restrict;

alter table payment_intents drop constraint payment_intents_payment_tenant_fkey;
alter table payment_intents add constraint payment_intents_payment_tenant_fkey
  foreign key (payment_id, tenant_id) references payments (id, tenant_id)
  on delete restrict;

alter table payment_intents drop constraint payment_intents_location_tenant_fkey;
alter table payment_intents add constraint payment_intents_location_tenant_fkey
  foreign key (location_id, tenant_id) references locations (id, tenant_id)
  on delete restrict;

-- 2. M-04 — the guard.
create or replace function payment_intents_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.state in ('committed', 'cancelled') then
    raise exception
      'payment_intents: state % is terminal and cannot be updated', old.state
      using errcode = '23514';
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.actor_id is distinct from old.actor_id
     or new.kind is distinct from old.kind
     or new.idempotency_key is distinct from old.idempotency_key
     or new.invoice_id is distinct from old.invoice_id
     or new.payment_id is distinct from old.payment_id
     or new.location_id is distinct from old.location_id
     or new.payload_fingerprint is distinct from old.payload_fingerprint
     or new.observation_kind is distinct from old.observation_kind
     or new.observed_intent_id is distinct from old.observed_intent_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
  then
    raise exception
      'payment_intents: identity, payload and observation columns are immutable'
      using errcode = '23514';
  end if;

  if old.state = 'prepared' and new.state = 'committed' then
    if new.result_id is null
       or new.committed_at is null
       or new.cancelled_at is not null
    then
      raise exception
        'payment_intents: committed transition must set result_id and committed_at and clear cancelled_at'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'prepared' and new.state = 'cancelled' then
    if new.cancelled_at is null
       or new.result_id is not null
       or new.committed_at is not null
    then
      raise exception
        'payment_intents: cancelled transition must set cancelled_at and clear result markers'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception
    'payment_intents: only prepared -> committed|cancelled is allowed'
    using errcode = '23514';
end;
$$;

revoke all on function payment_intents_guard_update() from public;

drop trigger if exists payment_intents_guard_update on payment_intents;
create trigger payment_intents_guard_update
  before update on payment_intents
  for each row execute function payment_intents_guard_update();

commit;
