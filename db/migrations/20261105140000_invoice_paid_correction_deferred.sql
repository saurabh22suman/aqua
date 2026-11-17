-- 20261105140000_invoice_paid_correction_deferred
--
-- The human's final decision (2026-11-05):
--
--   * an invoice that has already been PAID stays AS ISSUED;
--   * paid buyer/name corrections are DEFERRED for this release;
--   * NO refund, reversal, credit note or adjustment document is introduced.
--
-- The base migration (20261105120000_invoice_guest_payer.sql) already freezes
-- the identity of an issued document and refuses a rewrite of payer_kind,
-- member_id or guest_name. `voidInvoice` still refuses a document with money
-- recorded against it, so the only correction path (void -> reissue) is
-- unavailable for a paid invoice. That is now a DECIDED state, not an
-- undefined workflow.
--
-- This migration replaces ONE function body. It does not change any table,
-- constraint, privilege or trigger binding: `create or replace function`
-- keeps the existing invoices_payer_immutable_trg pointing at the same
-- function. The base migration's comments are historical; this is the
-- authoritative message for the paid case.
--
-- Forward-only. It drops nothing.

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

  -- The counter's own money updates (status, paid_paise, notes) never reach
  -- a refusal: only the identity columns are compared.
  if not (payer_changed or name_changed) then
    return new;
  end if;

  if old.paid_paise > 0 then
    if payer_changed then
      raise exception
        'the payer of an issued invoice is fixed (invoice %) — this invoice has money recorded against it, so it cannot be voided; paid buyer or payer corrections are deferred for this release and are not defined here',
        old.id
        using errcode = '23514';
    end if;

    raise exception
      'the buyer''s name on an issued invoice is fixed (invoice %) — this invoice has money recorded against it, so it cannot be voided; paid buyer or name corrections are deferred for this release and are not defined here',
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
