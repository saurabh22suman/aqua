-- 20261105120000_invoice_guest_payer
--
-- WR-1 / Option A — the invoice spine learns to name a payer that is
-- NOT a member.
--
-- The human's decision (2026-11-05) — "allow staff to issue bills for
-- walk-in bookings and manually record cash or UPI payments" — needs
-- the spine to carry a payer that is not a member. Today:
--
--   * invoices.member_id is NOT NULL and references members(id,
--     tenant_id);
--   * payments.member_id is NOT NULL with the same foreign key;
--   * recordPayment copies the invoice's payer into the payment row.
--
-- So removing the WALK_IN_BILL_ERROR guard alone would produce a
-- service that calls issueInvoiceInTx and is refused by the database.
--
-- The payer becomes EXPLICIT rather than implied:
--
--   * invoices.member_id becomes NULLABLE. The composite foreign key
--     still applies whenever it is present, so a member payer is still
--     tenant-checked; a null member simply means "this document is not
--     addressed to a member".
--   * invoices.payer_kind names which kind of payer it is ('member' or
--     'guest'), so no reader has to infer the payer from a NULL.
--   * invoices.guest_name carries the buyer's name on the document.
--   * payments.member_id becomes NULLABLE and payments.payer_kind is
--     added, because a payment inherits its payer from the invoice it
--     settles.
--
-- The two states are exclusive: a row can never be "a member invoice
-- with no member" nor "a guest invoice with a member".
--
-- No backfill is needed. payer_kind defaults to 'member' and every
-- existing invoice and payment keeps the member_id it already had, so
-- the new checks are satisfied by every existing row, and every
-- existing insert path (which always set member_id) still satisfies
-- them.
--
-- ---------------------------------------------------------------------------
-- REVIEW AMENDMENT (second pass, 2026-11-05) — three findings, closed here.
-- The review is docs/design/parallel-release/walk-in-approval/REVIEW-2026-11-05.md.
-- ---------------------------------------------------------------------------
--
-- R1 — AN ORPHAN GUEST PAYMENT WAS POSSIBLE.
--   The payer check said "a guest payment has no member", and the
--   trigger returned immediately when invoice_id was null. Between them
--   nothing said a guest payment must settle a document: the app role
--   holds INSERT on payments (db/migrations/20260915100000_payments.sql),
--   so it could write a payment row with payer_kind 'guest', no member
--   and NO invoice — money with no document, no buyer and no way to
--   reconcile it against anything.
--   FIXED by payments_guest_needs_invoice_check: a guest payment must
--   settle an invoice. The MEMBER branch is deliberately untouched, so
--   the wallet top-up (lib/services/wallet.ts writes a payments row
--   with invoice_id null and a member) keeps working exactly as before.
--
-- R2 — THE INVOICE'S PAYER COULD BE CHANGED UNDER A RECORDED GUEST
--      PAYMENT.
--   The composite foreign key cannot see it. MATCH SIMPLE skips a
--   foreign key when ANY referencing column is null, and a guest
--   payment's member_id IS null — so the payment-side check never
--   matched, and the referenced-side check (ON UPDATE NO ACTION) never
--   matched either (its lookup is `member_id = <old value>`, and the old
--   value is null). The payment trigger fires only when a PAYMENT row is
--   written, so an UPDATE of the invoice changed the payer underneath a
--   recorded payment and nothing noticed: the document said 'member',
--   the payment said 'guest', and no rule said they were the same payer.
--   FIXED by invoices_payer_immutable(): the payer of an issued
--   document is fixed. See WR-7 in the review — this is a DECISION for
--   the human, not the lane's; the alternative (re-pointable while no
--   money is recorded) is written up there with its RLS caveat.
--
-- R3 — THE DRIZZLE MIRROR MUST GROW WITH THE RULES, or db/schema/**
--      and the migration would disagree (the same disagreement that was
--      a review finding in the entry lane's D1).
--
-- ---------------------------------------------------------------------------
-- CORRECTION PASS (2026-11-05, read-only review follow-up) — three more
-- findings, closed here. The correction note is
-- docs/design/parallel-release/walk-in-approval/corrections-20261105/README.md.
-- ---------------------------------------------------------------------------
--
-- C1 — THE PAYER TRIGGER FAILED OPEN WHEN THE INVOICE WAS NOT VISIBLE.
--   The review's trigger ended its lookup with:
--
--       if not found then
--         -- The foreign key raises 23503 for a missing invoice. Stay out of it.
--         return new;
--       end if;
--
--   `not found` conflates two different situations, and only one of them
--   is safe:
--
--     (a) THE INVOICE DOES NOT EXIST (or belongs to another tenant).
--         The pre-existing foreign key payments_invoice_tenant_fkey
--         (invoice_id, tenant_id) -> invoices (id, tenant_id) refuses the
--         write with 23503. It is still enforced for a guest payment,
--         because that key's referencing columns (invoice_id, tenant_id)
--         are both NOT NULL for one — a guest payment's invoice_id is
--         forced NOT NULL by payments_guest_needs_invoice_check.
--
--     (b) THE INVOICE EXISTS BUT THIS TRANSACTION CANNOT SEE IT.
--         invoices has FORCE ROW LEVEL SECURITY and only the
--         tenant_isolation policy (plus the platform_admin policies),
--         and the trigger runs as the INVOKER, so its SELECT is subject
--         to the writing role's own RLS. When the lookup returns
--         nothing, the trigger's `return new` WAVEED THE WRITE THROUGH
--         without ever comparing the payers — and for a guest payment
--         the composite foreign key CANNOT close that gap (MATCH SIMPLE
--         skips it when the referencing column member_id is null).
--
--   In the application today (b) is masked, because a payment row can
--   only be written when app.tenant_id matches the payment's tenant
--   (tenant_isolation) or app.platform_admin is set
--   (platform_admin_write) — and the invoices table carries the
--   platform_admin_select policy for the same variable. So the trigger
--   is not reached with an invisible invoice through the app pool. That
--   masking is INCIDENTAL: it depends on the pre-existing
--   payments_invoice_tenant_fkey surviving, which is why C2 asserts it.
--   The trigger must not rely on a masking that a later migration could
--   remove, so the branch now FAILS CLOSED.
--
--   The one case where the trigger deliberately stays out of the way is
--   a write made from a transaction scoped to a DIFFERENT tenant: that
--   write is not this tenant's to make, and the payments table's own
--   tenant_isolation policy refuses it with 42501. Keeping that
--   refusal in the RLS means the error names the tenant boundary
--   instead of the payer, and it keeps this branch's behaviour
--   independent of whether PostgreSQL evaluates the row-level policy
--   before or after this BEFORE-row trigger.
--
-- C2 — THE TRIGGER'S SAFETY DEPENDS ON A PRE-EXISTING FOREIGN KEY.
--   The assertion below FAILS LOUDLY at migration time if
--   payments_invoice_tenant_fkey is missing, rather than letting the
--   guest case lose its only backstop silently. (House pattern: the
--   role assertion in
--   db/migrations/20261030062319_whatsapp_outbox_claim_state.sql.)
--
-- C3 — THE BUYER'S NAME HAS A LENGTH LIMIT IN THE DATABASE TOO.
--   guest_name is legal data on a tax invoice: it names the buyer. The
--   service already caps it (issueInvoiceInputSchema: min 1, max 120)
--   and the booking it comes from is capped the same way
--   (bookings.walk_in_name: a database check of 1..120 and the
--   create-booking Zod schema's max(120)). A direct app-role write
--   could still store an unbounded name, and a name with no bound is a
--   name no surface can lay out. The check below gives the column the
--   SAME bound as its source. This closes the packet's own G8/I-6 and
--   is an ADDITION to the schema lane's approval item.
--
-- ---------------------------------------------------------------------------
-- DECISION PASS (2026-11-05, third pass) — the human's decision, and the
-- rule it settles. The decision note is
-- docs/design/parallel-release/walk-in-approval/decision-20261105/README.md.
-- ---------------------------------------------------------------------------
--
-- D-1 — THE HUMAN'S DECISION (2026-11-05).
--   "An issued walk-in invoice with the wrong buyer, and a typo in its
--   guest name, should be corrected by VOIDING AND REISSUING rather than
--   editing the original."
--
--   Two questions are settled by it:
--
--     WR-7 — may an issued document's PAYER be corrected?  NO. The payer
--            is fixed at issue. (The review's alternative — re-pointable
--            while no money is recorded — is NOT taken.)
--     WR-8 — may the BUYER'S NAME on an issued guest document be
--            corrected?  NO. The name is fixed at issue too.
--
--   WHAT THIS MIGRATION CHANGES FOR IT:
--
--     * the invoices_payer_immutable trigger now freezes THREE columns —
--       payer_kind, member_id AND guest_name. Before this pass the name
--       was still rewritable by any writer holding UPDATE on invoices
--       (the app role does: db/migrations/20260915090000_invoices.sql
--       grants select, insert, update, delete to app_user), so the
--       "correct it in place" path the human has ruled out was still
--       open at the database level. It is now closed.
--
--     * the trigger's message is case-specific, and the paid case does
--       NOT promise a void. voidInvoice refuses a document that has
--       money recorded against it ("Payments are recorded against this
--       invoice; it cannot be voided." — lib/services/invoice-mutations.ts),
--       so "void it and issue a new one" is a correction path for an
--       UNPAID bill only. For a bill with money on it there is no
--       correction workflow in the product at all, and the message says
--       so instead of sending the operator to a dead end. The paid case
--       is left EXPLICITLY UNRESOLVED (WR-9) — no refund, no credit
--       note and no reversal is invented here.
--
--     * the rule itself does NOT depend on whether money is recorded.
--       The document is immutable from issue, in both cases; only the
--       ADVICE in the message differs.
--
-- C4 — THE TWO STATES ARE EXCLUSIVE ABOUT THE NAME AS WELL.
--   The packet's own invariant says a member document "always has a
--   member" and a guest document "never has one and always has a
--   non-blank buyer name" — but the check as written did not say that a
--   MEMBER document carries no buyer name, so a member invoice could
--   hold a guest_name that nothing would ever read. The member branch
--   now requires guest_name is null. Nothing existing breaks: the
--   column is new in this migration, every existing row has null, and
--   the issue service writes null for a member payer
--   (lib/services/invoice-issue.ts). This is an ADDITION to the schema
--   lane's approval item, not a replacement.
--
-- Forward-only: this migration relaxes, adds and constrains. It drops
-- nothing.

alter table invoices alter column member_id drop not null;
alter table payments alter column member_id drop not null;

alter table invoices add column payer_kind text not null default 'member';
alter table invoices add column guest_name text;
alter table payments add column payer_kind text not null default 'member';

alter table invoices
  add constraint invoices_payer_kind_check
  check (payer_kind in ('member', 'guest'));

-- C3 — the buyer's name is bounded exactly like the booking name it
-- comes from (bookings_walk_in_name_check: char_length between 1 and
-- 120). A member payer has no guest name at all, so the bound only
-- applies to the name that is there.
alter table invoices
  add constraint invoices_guest_name_length_check
  check (guest_name is null or char_length(guest_name) between 1 and 120);

-- C4 — the member branch also says "and no buyer name". A member
-- document's buyer is the member's own person record; a name on the
-- document itself would be a second, unreadable copy of it.
alter table invoices
  add constraint invoices_payer_check
  check (
    (payer_kind = 'member' and member_id is not null and guest_name is null)
    or (
      payer_kind = 'guest'
      and member_id is null
      and guest_name is not null
      and btrim(guest_name) <> ''
    )
  );

alter table payments
  add constraint payments_payer_kind_check
  check (payer_kind in ('member', 'guest'));

alter table payments
  add constraint payments_payer_check
  check (
    (payer_kind = 'member' and member_id is not null)
    or (payer_kind = 'guest' and member_id is null)
  );

-- R1 — a guest payment settles a document.
--
-- A guest has no member, so the ONLY thing that identifies the payer
-- of a guest payment is the invoice it settles. A guest payment with
-- no invoice is an orphan: no document, no buyer name, no number, and
-- nothing for the fees ledger, the reconciliation or the cash count to
-- hang it on. The rule is separate from payments_payer_check (one
-- constraint per rule, the house shape) so the refusal names itself.
--
-- The member branch is NOT constrained: a member payment with no
-- invoice is the wallet top-up (lib/services/wallet.ts writes a
-- payments row with invoice_id null, a member, a location, a method and
-- an optional reference). That is real money with a real payer, and it
-- must keep working.
alter table payments
  add constraint payments_guest_needs_invoice_check
  check (payer_kind <> 'guest' or invoice_id is not null);

-- The payment's payer must BE the invoice's payer.
--
-- A composite foreign key says it for the member case: the payment's
-- (invoice_id, tenant_id, member_id) must equal the invoice's
-- (id, tenant_id, member_id). PostgreSQL's MATCH SIMPLE semantics skip
-- a foreign key when ANY referencing column is NULL, and a guest
-- payment's member_id IS null — so this key is enforced for a member
-- payment and skipped for a guest payment. The unique constraint it
-- needs is (id, tenant_id, member_id); id is already unique, so this
-- adds no new row space.
alter table invoices
  add constraint invoices_id_tenant_payer_key
  unique (id, tenant_id, member_id);

alter table payments
  add constraint payments_invoice_payer_tenant_fkey
  foreign key (invoice_id, tenant_id, member_id)
  references invoices (id, tenant_id, member_id);

-- C2 — THE BACKSTOP THE TRIGGER RELIES ON MUST EXIST.
--
-- payments_invoice_tenant_fkey (invoice_id, tenant_id) -> invoices
-- (id, tenant_id) was created in
-- db/migrations/20260915100000_payments.sql and is NOT replaced by the
-- composite key above: the composite key is skipped for a guest
-- payment (MATCH SIMPLE skips a key whose referencing column is null),
-- while this one always fires for a payment that names an invoice
-- (both of its referencing columns are NOT NULL).
--
-- The trigger below refuses a write whose invoice it cannot see. The
-- only thing that tells "the invoice does not exist" apart from "the
-- invoice is not visible to this transaction" — the two cases the
-- trigger's lookup cannot tell apart on its own — is the existence of
-- this foreign key. If a later migration dropped it, the guest case
-- would lose its only backstop and nothing would say so. So the
-- migration ASSERTS it, loudly, instead of relying on it silently.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'payments'::regclass
       and conname = 'payments_invoice_tenant_fkey'
       and contype = 'f'
  ) then
    raise exception
      'payments_invoice_tenant_fkey is missing: the guest payer''s only backstop for "the invoice does not exist" is gone, and payments_payer_matches_invoice() can no longer tell a missing invoice from an invisible one. Restore the foreign key (invoice_id, tenant_id) -> invoices (id, tenant_id) before applying this migration.';
  end if;
end
$$;

-- The guest case of the same rule: a payment with no member must
-- belong to a GUEST invoice, and a guest invoice's payments must carry
-- no member. The foreign key above cannot say it (MATCH SIMPLE skips
-- it when a referencing column is null), so the rule is a trigger.
--
-- It is NOT a decorative backstop. The app role holds INSERT on
-- payments, so the database is the only thing standing between a
-- direct write and a payment whose payer is not its invoice's payer:
-- recordPayment copies the payer from the invoice it settles inside
-- the same transaction, but nothing in the service layer can stop a
-- second writer. The trigger is what makes the invariant a DATABASE
-- invariant rather than a service convention.
--
-- THE LOOKUP IS SUBJECT TO ROW LEVEL SECURITY (the trigger runs as the
-- invoker, and invoices has FORCE ROW LEVEL SECURITY), so "not found"
-- does NOT mean "does not exist" — it means "this transaction cannot
-- see it". See C1: the branch therefore FAILS CLOSED instead of
-- waving the write through.
create or replace function payments_payer_matches_invoice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  invoice_member_id uuid;
  invoice_payer_kind text;
  scoped_tenant uuid;
begin
  if new.invoice_id is null then
    -- A wallet top-up has no invoice; there is no payer to match.
    -- (A GUEST payment cannot reach this branch: R1's
    -- payments_guest_needs_invoice_check refuses it first.)
    return new;
  end if;

  -- The tenant this transaction is scoped to, if any. withTenant()
  -- sets it transaction-scoped (db/tenant.ts); withPlatformAdmin()
  -- does not (db/scope.ts).
  scoped_tenant := nullif(current_setting('app.tenant_id', true), '')::uuid;

  select i.member_id, i.payer_kind
    into invoice_member_id, invoice_payer_kind
    from invoices i
   where i.id = new.invoice_id
     and i.tenant_id = new.tenant_id;

  if found then
    if new.member_id is distinct from invoice_member_id
       or new.payer_kind is distinct from invoice_payer_kind then
      raise exception
        'the payment payer must match the invoice payer (invoice %, invoice payer % / member %)',
        new.invoice_id,
        invoice_payer_kind,
        invoice_member_id
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- THE INVOICE WAS NOT FOUND BY THE LOOKUP ABOVE. Two cases, and the
  -- difference is the whole point of the rule.
  if scoped_tenant is not null and scoped_tenant <> new.tenant_id then
    -- (a) THIS TRANSACTION IS SCOPED TO ANOTHER TENANT. The write is
    -- not this tenant's to make: the payments table's own
    -- tenant_isolation policy refuses it with 42501. Staying out of the
    -- way keeps the error honest — it names the tenant boundary
    -- instead of the payer — and it keeps this branch's behaviour the
    -- same whether PostgreSQL evaluates the row-level policy before or
    -- after this BEFORE-row trigger.
    return new;
  end if;

  -- (b) THE INVOICE COULD NOT BE SEEN FROM A SCOPE THAT IS ALLOWED TO
  -- WRITE THIS PAYMENT. The payer cannot be verified, and the only
  -- rule that could verify it — the composite foreign key
  -- (invoice_id, tenant_id, member_id) -> invoices (id, tenant_id,
  -- member_id) — is SKIPPED for a guest payment (MATCH SIMPLE skips a
  -- key whose referencing column is null). So the write FAILS CLOSED:
  -- an unverifiable payer is refused, never accepted.
  --
  -- This is also the branch a genuinely missing invoice lands in. The
  -- error names both possibilities on purpose: from inside the
  -- database the two cannot be told apart without a read that ignores
  -- row-level security, and the refusal is the same either way.
  raise exception
    'the payment payer could not be verified: invoice % does not exist or is not visible to this transaction (a payment must settle an invoice this transaction can see)',
    new.invoice_id
    using errcode = '23514';
end;
$$;

revoke all on function payments_payer_matches_invoice() from public;

drop trigger if exists payments_payer_matches_invoice_trg on payments;
create trigger payments_payer_matches_invoice_trg
  before insert or update on payments
  for each row
  execute function payments_payer_matches_invoice();

-- R2 + D-1 — THE PAYER AND THE BUYER'S NAME OF AN ISSUED DOCUMENT ARE
-- FIXED.
--
-- A payment names the payer of the document it settles. If the
-- document's payer can change underneath a recorded payment, the two
-- disagree and NOTHING can repair the history: the payment-side
-- trigger only fires when a payment row is written, and the composite
-- foreign key cannot see a guest payment at all (MATCH SIMPLE skips a
-- key whose referencing column is null, and a guest payment's
-- member_id is null — on the payment side and on the invoice side).
--
-- So the invoice gets its own guard. It compares only the IDENTITY
-- columns — payer_kind, member_id and guest_name; every other invoice
-- column stays the counter's to move:
--
--   * status and paid_paise are written by recordPayment,
--     reversePayment, voidInvoice and the café's void path on every
--     single money movement, and are NOT guarded;
--   * notes, invoice_number and the rest are untouched by the guard.
--
-- THE HUMAN'S DECISION (2026-11-05) is what makes the NAME guarded as
-- well. An issued walk-in invoice with the wrong buyer, and a typo in
-- its guest name, are corrected by VOIDING AND REISSUING — not by
-- editing the original. Before this pass the name was still rewritable
-- in place by any writer holding UPDATE on invoices, so the path the
-- human has ruled out was still open at the database level. It is now
-- closed: the trigger freezes the name exactly as it freezes the
-- payer.
--
-- THE TENANT CLEANUP IS UNTOUCHED: this is a BEFORE UPDATE trigger, so
-- DELETE (including the tenant cascade) never reaches it.
--
-- WHY IMMUTABILITY AND NOT "MAY CHANGE WHILE NO MONEY IS RECORDED":
-- the softer rule needs the guard to READ the payments table, and the
-- payments table is under FORCE ROW LEVEL SECURITY — outside a tenant
-- transaction the guard would see no payments and would wave a
-- privileged update through. Immutability needs no read at all, so it
-- holds for every role, including the privileged one, and it leaves no
-- window in which a concurrent update can slip between the guard's
-- check and the payment's commit. The review wrote the alternative up
-- as WR-7 (docs/design/parallel-release/walk-in-approval/REVIEW-2026-11-05.md
-- §3.4); the human has now chosen AGAINST it, so the alternative is
-- recorded here as NOT taken.
--
-- THE MESSAGE IS HONEST ABOUT WHAT THE PRODUCT CAN ACTUALLY DO.
-- voidInvoice refuses a document that already has money on it
-- (lib/services/invoice-mutations.ts: `if (Number(invoice.paidPaise) > 0)
-- then ... "Payments are recorded against this invoice; it cannot be
-- voided."`), so "void the document and issue a new one" is a
-- correction path for an UNPAID bill only. For a bill that has been
-- paid there is no correction workflow in the product at all, and
-- saying otherwise would send an operator to a dead end. The message
-- therefore states the two cases separately, and the paid case is left
-- explicitly UNRESOLVED — see WR-7, WR-8 and WR-9 in
-- docs/design/parallel-release/walk-in-approval/decision-20261105/README.md.
create or replace function invoices_payer_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  payer_changed boolean;
  name_changed boolean;
begin
  payer_changed := new.payer_kind is distinct from old.payer_kind
                or new.member_id is distinct from old.member_id;
  name_changed := new.guest_name is distinct from old.guest_name;

  -- The counter's own money updates (status, paid_paise, notes) never
  -- reach a refusal: only the identity columns are compared.
  if not (payer_changed or name_changed) then
    return new;
  end if;

  if old.paid_paise > 0 then
    if payer_changed then
      raise exception
        'the payer of an issued invoice is fixed (invoice %) — this invoice has money recorded against it, so it cannot be voided; the correction workflow for a paid invoice is not defined',
        old.id
        using errcode = '23514';
    end if;

    raise exception
      'the buyer''s name on an issued invoice is fixed (invoice %) — this invoice has money recorded against it, so it cannot be voided; the correction workflow for a paid invoice is not defined',
      old.id
      using errcode = '23514';
  end if;

  if payer_changed then
    raise exception
      'the payer of an issued invoice is fixed (invoice %) — void this unpaid invoice and issue a new one',
      old.id
      using errcode = '23514';
  end if;

  raise exception
    'the buyer''s name on an issued invoice is fixed (invoice %) — void this unpaid invoice and issue a new one',
    old.id
    using errcode = '23514';
end;
$$;

revoke all on function invoices_payer_immutable() from public;

drop trigger if exists invoices_payer_immutable_trg on invoices;
create trigger invoices_payer_immutable_trg
  before update on invoices
  for each row
  execute function invoices_payer_immutable();
