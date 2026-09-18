-- 20260918103000_k04_payment_methods
--
-- K-04 (Release 1 café payments) — widen the counter method set with
-- the two café paths Release 1 needs: `card` (terminal reference
-- only; no card data ever touches our systems) and `other` (anything
-- else the counter accepts, still with a reference). The application
-- layer requires a reference for every non-cash method; the existing
-- payments_tenant_method_reference_uidx (tenant, method, reference)
-- uniqueness backstop covers the new methods unchanged.
--
-- The constraint name is the one PostgreSQL auto-assigned in
-- 20260915100000_payments.sql (verified on a migrated database).

alter table payments drop constraint payments_method_check;

alter table payments
  add constraint payments_method_check
  check (method in ('cash', 'upi', 'bank_transfer', 'card', 'other'));
