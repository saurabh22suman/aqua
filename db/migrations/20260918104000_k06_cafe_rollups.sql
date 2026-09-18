-- 20260918104000_k06_cafe_rollups
--
-- K-06 (Release 1 café reconciliation) — the nightly reports.rollup
-- row gains café collections, counted separately from the membership
-- totals so the owner report can show both without a parallel report.
--
-- Definition, identical to lib/services/reconciliation.ts and
-- lib/jobs/reports-rollup-job.ts: a café payment is a captured
-- payment settled against an invoice whose source = 'cafe';
-- cafe_orders counts the distinct such invoices settled that day.

alter table daily_rollups add column cafe_paise bigint not null default 0;

alter table daily_rollups
  add constraint daily_rollups_cafe_paise_check check (cafe_paise >= 0);

alter table daily_rollups add column cafe_orders integer not null default 0;

alter table daily_rollups
  add constraint daily_rollups_cafe_orders_check check (cafe_orders >= 0);
