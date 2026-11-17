-- member_account_binding_confirmation
-- POSTIMAGE — db/migrations/20261108210136_member_account_binding_confirmation.sql  (candidate, NOT applied)
--
-- The staff attestation that this ACCOUNT is this MEMBER's account, for a
-- link whose account number differs from the club's recorded member
-- number. THE SETTLED DECISION OF 7 NOVEMBER 2026:
-- "an OWNER, or a FACILITY-LIMITED MANAGER, confirms the mismatched
-- identity".
--
-- PROPOSED FILENAME. The coordinator mints and validates the final name;
-- it must sort after 20261109100000.
--
-- WHAT THIS IS NOT, AND IT IS NOT A SMALL POINT
--   It is NOT a phone-ownership verification. There is no OTP channel in
--   this product, no SMS is sent, and the messaging provider is MOCKED
--   outside production, so no possession check of any kind happens here.
--   It never sets phone_number_verified, it never rewrites the club's
--   recorded number, and it never writes users.phone.
--
--   It is a STAFF ATTESTATION ABOUT A PAIRING. It carries no number - not
--   the member's, not the account's, not a hash of either.
--
-- WHY FOUR COLUMNS AND NOT THREE - THE BASIS MUST NAME THE ACTOR
--   "owner OR an assigned facility manager" is a SCOPING decision: the
--   "assigned" is the whole point of the second branch, and a row that
--   says only 'staff_attestation' cannot say which actor stood behind the
--   pairing or which facility the manager was assigned to.
--
--   So the basis is a CLOSED SET OF TWO:
--     'owner_attestation'             - the club's owner.
--     'facility_manager_attestation'  - a manager the owner granted the
--                                       key to, acting within the
--                                       facilities they are assigned to.
--   and the fourth column, account_binding_facility_id, records WHICH
--   facility the manager's attestation was scoped to. The CHECK below
--   makes the two cases mutually exclusive:
--     owner_attestation             -> facility_id IS NULL
--     facility_manager_attestation  -> facility_id IS NOT NULL
--
--   The facility column carries a COMPOSITE foreign key to
--   locations(id, tenant_id), so an attestation cannot name a facility in
--   another club: locations already carries `unique (id, tenant_id)`
--   (db/schema/locations.ts:42).
--
--   WHAT THE SCHEMA DOES NOT DO: it does not verify that the confirmer
--   actually holds the members.link.confirm grant, nor that a manager is
--   assigned to the named facility. Both are the action layer's checks
--   (lib/services/member-link-binding.ts).
--
-- WHY THE CONFIRMER'S ID CARRIES NO FOREIGN KEY
--   With `on delete set null`, deleting the confirming user would set
--   account_binding_confirmed_by_user_id to NULL while the other columns
--   kept their values - and the quartet-together CHECK would then
--   evaluate to false, so the DELETE WOULD BE REFUSED by the database. A
--   platform user delete would fail with a constraint violation in the
--   middle of an unrelated operation.
--
--   The confirmer's id is EVIDENCE, not a live reference, and the audit
--   row is the record of it. This is the reserved lane's own convention
--   on exactly these two tables: verified_by_user_id and
--   revoked_by_user_id are plain uuids with no references().
--
--   THE RESIDUAL, STATED: because there is no foreign key, a confirming
--   user can later be deleted and the attestation keeps standing, naming
--   an id that no longer resolves to a users row. Named residual R-1.
--
-- ORDERING
--   This file lands AFTER 20261108210134_member_self_links.sql, which
--   creates the tables. db/migrate.ts:77-81 re-throws on the first
--   failure and SKIPS EVERY LATER MIGRATION, so a file that runs before
--   its tables exist stops the whole chain.
--
-- THIS FILE CONTAINS NOTHING ELSE
--   No grant, no revoke, no create policy, no insert, no update. The
--   permission catalogue and the role grant are a separate artefact
--   (20261109100400) because they have different reviewers and different
--   risks.

alter table member_account_links
  add column if not exists account_binding_confirmed_by_user_id uuid,
  add column if not exists account_binding_confirmed_at timestamptz,
  add column if not exists account_binding_basis text,
  add column if not exists account_binding_facility_id uuid;

alter table member_account_links
  add constraint member_account_links_account_binding_check
  check (
    (account_binding_confirmed_by_user_id is null
     and account_binding_confirmed_at is null
     and account_binding_basis is null
     and account_binding_facility_id is null)
    or
    (account_binding_confirmed_by_user_id is not null
     and account_binding_confirmed_at is not null
     and (
       (account_binding_basis = 'owner_attestation'
        and account_binding_facility_id is null)
       or
       (account_binding_basis = 'facility_manager_attestation'
        and account_binding_facility_id is not null)
     ))
  );

-- The facility scope of a manager's attestation is TENANT-BOUND: the
-- composite key is (facility_id, tenant_id) -> locations (id, tenant_id).
-- MATCH SIMPLE means a NULL facility_id satisfies the constraint, which
-- is exactly what the owner's branch needs.
alter table member_account_links
  add constraint member_account_links_account_binding_facility_fkey
  foreign key (account_binding_facility_id, tenant_id)
  references locations (id, tenant_id);

alter table guardian_child_links
  add column if not exists account_binding_confirmed_by_user_id uuid,
  add column if not exists account_binding_confirmed_at timestamptz,
  add column if not exists account_binding_basis text,
  add column if not exists account_binding_facility_id uuid;

alter table guardian_child_links
  add constraint guardian_child_links_account_binding_check
  check (
    (account_binding_confirmed_by_user_id is null
     and account_binding_confirmed_at is null
     and account_binding_basis is null
     and account_binding_facility_id is null)
    or
    (account_binding_confirmed_by_user_id is not null
     and account_binding_confirmed_at is not null
     and (
       (account_binding_basis = 'owner_attestation'
        and account_binding_facility_id is null)
       or
       (account_binding_basis = 'facility_manager_attestation'
        and account_binding_facility_id is not null)
     ))
  );

alter table guardian_child_links
  add constraint guardian_child_links_account_binding_facility_fkey
  foreign key (account_binding_facility_id, tenant_id)
  references locations (id, tenant_id);
