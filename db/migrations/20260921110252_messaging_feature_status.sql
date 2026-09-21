-- messaging_feature_status
-- PR1-C7 — the friend pilot ships the existing mock messaging provider
-- only; no WhatsApp Cloud adapter is in scope. The catalogue previously
-- marked messaging 'ga', which overclaimed. Move the row to 'internal'
-- (catalogued, not customer-facing) for every existing database; the
-- reference catalogue migration and db/seed-platform.ts carry the same
-- value for new installs. The real integration is documented as
-- post-pilot in docs/messaging-post-pilot.md.

update features
   set status = 'internal'
 where key = 'messaging';
