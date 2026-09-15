-- tenants_trial_expires_at
--
-- PR2 (ops tenant health) needs a trial-expiry signal on the tenant
-- itself. It previously existed only on platform_leads.trial_expires_at,
-- and only for tenants that came through lead conversion — a tenant
-- created directly via "New tenant" had no expiry field at all.
--
-- Nullable: a tenant with no trial_expires_at simply produces no
-- trial-expiry signal in the health computation (not an error, not a
-- forced default — most tenants are not on trial at all).
--
-- Backfill from platform_leads for tenants that DO have a conversion
-- record. Tenants created directly still get NULL here; wiring
-- createTenantAction to set a default trial length is a separate,
-- undecided product question (default trial duration) and stays out
-- of this migration.

alter table tenants add column trial_expires_at timestamptz;

update tenants t
set trial_expires_at = pl.trial_expires_at
from platform_leads pl
where pl.converted_tenant_id = t.id
  and pl.trial_expires_at is not null
  and t.trial_expires_at is null;
