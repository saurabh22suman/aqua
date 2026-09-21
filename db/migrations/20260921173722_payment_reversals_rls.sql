-- payment_reversals_rls
-- PR2-C8 follow-up — payment_reversals shipped in
-- 20260921173408_payment_reversals.sql without its RLS gate; the
-- isolation catch-all (tests/tier1/isolation.test.ts) requires every
-- tenant table to have RLS enabled and forced. Same policy shape as
-- payments (20260915100000_payments.sql). Forward-only: the original
-- migration stays as applied.

alter table payment_reversals enable row level security;
alter table payment_reversals force row level security;

create policy tenant_isolation on payment_reversals
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy platform_admin_select on payment_reversals
  for select
  using (current_setting('app.platform_admin', true) = 'true');

create policy platform_admin_write on payment_reversals
  using (current_setting('app.platform_admin', true) = 'true')
  with check (current_setting('app.platform_admin', true) = 'true');
