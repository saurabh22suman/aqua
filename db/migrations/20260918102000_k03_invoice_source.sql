-- 20260918102000_k03_invoice_source
--
-- K-03 (Release 1 café module) — the café ↔ invoice bridge. The
-- invoice remains the legal document (gapless FY numbering reused
-- unchanged); `source` records where it came from so the café
-- payment rule (K-04) and café reconciliation (K-06) can find café
-- invoices without a parallel table.
--
-- Existing invoices default to 'membership' — the only origin that
-- existed before this migration. The check is a closed set.

alter table invoices add column source text not null default 'membership';

alter table invoices
  add constraint invoices_source_check
  check (source in ('membership', 'cafe', 'other'));
