-- 20260918130000_k05_account_entries
--
-- K-05 (Release 1.1 fast-follow) — the member wallet ledger:
-- append-only account entries for tabs, advances and package credits.
-- Release 1 café takes counter payments only; this is how a member's
-- account balance becomes derivable and auditable.
--
-- Shape decisions:
--   * `id` is UUIDv7 generated app-side — no gen_random_uuid()
--     default (H-02 convention; time-ordered and index-friendly).
--   * Money is integer paise as bigint: `amount_paise > 0` (direction
--     carries the sign) and `balance_after_paise >= 0` (the database
--     is the last line of defence against a negative wallet; the
--     service refuses the debit before this check fires).
--   * APPEND-ONLY. There is no `updated_at`/`updated_by` and no
--     UPDATE/DELETE grant: corrections are new entries, never edits.
--     A debit that would take the balance negative is refused at the
--     service layer; the balance_after check is the backstop.
--   * Idempotency is structural: unique (tenant_id, idempotency_key).
--     A replayed operation (double-tap, request retry) inserts nothing
--     and returns the existing entry — the service locks the member
--     row first so same-member replays serialise.
--   * `source_id` is a deliberate soft reference (polymorphic: the
--     payment, order or invoice an entry came from). No FK — the
--     ledger outlives the thing that caused the entry.
--   * RLS: enable + force, the standard nullif tenant policy;
--     tenant-leading indexes. Grants SELECT + INSERT only.
--     bootstrap-roles.ts's append-only list carries this table too,
--     because its blanket GRANT + default privileges would otherwise
--     restore UPDATE/DELETE on the next deploy.

create table account_entries (
  id                  uuid not null,          -- UUIDv7, generated app-side
  tenant_id           uuid not null references tenants(id) on delete cascade,
  member_id           uuid not null,
  direction           text not null,
  amount_paise        bigint not null,
  balance_after_paise bigint not null,
  source_type         text not null,
  source_id           uuid,
  idempotency_key     text not null,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  constraint account_entries_direction_check
    check (direction in ('debit', 'credit')),
  constraint account_entries_amount_check check (amount_paise > 0),
  constraint account_entries_balance_check check (balance_after_paise >= 0),
  constraint account_entries_source_type_check
    check (source_type in ('topup', 'charge', 'refund', 'adjustment')),
  constraint account_entries_idempotency_check
    check (char_length(idempotency_key) between 1 and 200),
  constraint account_entries_id_tenant_key unique (id, tenant_id),
  constraint account_entries_tenant_idempotency_key
    unique (tenant_id, idempotency_key),
  constraint account_entries_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id)
);

create index account_entries_tenant_member_created_idx
  on account_entries (tenant_id, member_id, created_at desc, id desc);

create index account_entries_tenant_source_idx
  on account_entries (tenant_id, source_type, source_id);

alter table account_entries enable row level security;
alter table account_entries force row level security;

create policy tenant_isolation on account_entries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert on account_entries to app_user;
revoke update, delete on account_entries from app_user;
