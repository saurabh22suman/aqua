-- ba_account.issuer — better-auth 1.7.1 account schema drift.
-- 2026-09-11 auth feature, slice 3.
--
-- better-auth 1.7.1 tags every account with an issuer:
--   credential accounts -> createLocalAccountIssuer("credential")
--                       = "local:credential"
-- and its internal findCredentialAccount() filters on
-- (userId, providerId, issuer, accountId). The @better-auth/drizzle-
-- adapter builds that WHERE clause from the Drizzle schema object;
-- when a field is missing from the schema, the adapter emits an
-- empty SQL fragment and the query dies with a syntax error. The
-- ba_account table predates this field (migration 0005 was written
-- against an older better-auth), so the column is missing.
--
-- Why this lands now: the phone+PIN flow is the first code path in
-- this repo that calls findCredentialAccount (setCredential's
-- find-then-link logic, and signInEmail's password verification).
-- The phone-OTP plugin also calls it in some flows; those flows have
-- simply never been exercised.
--
-- Nullable on purpose: better-auth supplies an issuer on every
-- account it creates, but legacy rows for providers this repo does
-- not use have no meaningful value to invent. The backfill labels
-- the one kind of row this repo has ever had (credential).

alter table ba_account add column issuer text;

update ba_account
   set issuer = 'local:credential'
 where provider_id = 'credential'
   and issuer is null;
