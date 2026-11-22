-- member_self_links
-- POSTIMAGE — db/migrations/20261108210134_member_self_links.sql  (candidate, NOT applied)
--
-- The member/guardian LINK tables: one account's link to one membership
-- (member_account_links) and to one CHILD through the club's guardianship
-- row (guardian_child_links).
--
-- PROPOSED FILENAME. The coordinator mints and validates the final name;
-- it must sort AFTER the current latest migration
-- (20261101000000_booking_whole_conflicts.sql) and match
-- /^(\d{14})_[a-z0-9_]+\.sql$/ (scripts/check-migration-naming.ts).
--
-- WHY THE 'invited' STATE IS HERE AND NOT IN A LATER MIGRATION
--   The table is created here, so there is nothing to ALTER. The order the
--   phone-confirmation packet required is still honoured: the binding
--   columns (20261109100100) land after this file.
--
-- WHY THE UNIQUE INDEX PREDICATES SAY `status in ('active', 'invited')`
--   With the narrower predicate (`status = 'active'`), a member could hold
--   an 'invited' link AND an 'active' link at the same time, and the
--   activation's 'invited' -> 'active' flip would then raise a UNIQUE
--   VIOLATION - a database error on a routine path, instead of a refusal.
--   The index NAMES are the reserved lane's; only the predicate is
--   narrowed, and the narrowing is what makes the state machine
--   representable. Six predicates change: four unique and two recorded-
--   phone lookups (two unique + one lookup on each table).
--
-- WHY guardianships GETS A UNIQUE CONSTRAINT FIRST
--   The composite foreign key below points at guardianships(id,
--   tenant_id). Postgres requires the referenced columns to carry a UNIQUE
--   (or primary key) constraint, and guardianships has NEITHER:
--   db/migrations/0015_consent_dpdp.sql:9-24 declares
--   `unique (tenant_id, minor_id, guardian_id)` and nothing else. The
--   foreign key would therefore FAIL TO CREATE with "there is no unique
--   constraint matching given keys for referenced table guardianships" -
--   and db/migrate.ts:77-81 re-throws on the first failure and SKIPS EVERY
--   LATER MIGRATION.
--
--   persons and members both already carry `unique (id, tenant_id)`
--   (db/migrations/0006_domain_schema.sql:13 and :43). guardianships is
--   the odd one out, and this constraint brings it in line with the
--   repository's own convention for every composite-FK target. It is
--   logically a no-op (id is already the primary key) and it is a
--   PROTECTED-PATH change.
--
-- WHY BOTH LINK TABLES ALSO CARRY unique (id, tenant_id, user_id)
--   The session tables name the link rows they are bound to
--   (20261109100200). A FOREIGN KEY may only reference columns that carry
--   a unique constraint, and the reference this schema needs is not
--   (id, tenant_id) but (id, tenant_id, user_id) - the binding must be to
--   a link that belongs to the SAME ACCOUNT as the session, or a session
--   could be bound to another member's membership and would then carry
--   that member's entitlements.
--
-- THE PHYSICAL NAME verified_phone IS INHERITED AND MISLEADING.
--   It is a snapshot of the number on the club's member record at
--   provisioning. It is NOT an SMS check, NOT an OTP and NOT proof that the
--   person owns the phone. verification_method is 'club_record' only: the
--   product has no delivery channel that could prove possession. No
--   surface may call this number verified.
--
-- EVERY INDEX LEADS WITH tenant_id.
--   scripts/lib/tenant-conventions-scan.ts:119-151 requires every
--   `create index` / `create unique index` on a non-platform table to
--   lead with tenant_id, and .github/workflows/ci.yml:142 runs that scan
--   on every migration at or after the 20260918050000 cutoff. All nine
--   indexes below lead with tenant_id, so the scan passes with NO change
--   to the scan and NO exemption entry.
--
-- ON DELETE CASCADE UNDER FORCE ROW LEVEL SECURITY - A RESIDUAL, NOT A FACT
--   These tables carry `force row level security`, so the table OWNER is
--   subject to the policy too. Whether a cascade fired from outside a
--   tenant scope deletes the children, deletes none of them, or is
--   REFUSED by the foreign-key check is a Postgres-semantics question
--   that a static reading cannot settle. This file therefore makes NO
--   CLAIM about the outcome; it is named residual R-6, and the approval
--   note in the handoff carries it.
--
--   In practice the member rows are SOFT-deleted (members.deleted_at,
--   db/schema/people.ts:67) and the link row is REVOKED (status ->
--   'revoked'), not cascaded. The cascade is the backstop for a hard
--   delete.

-- 1. The prerequisite unique constraint (see the header).
alter table guardianships
  add constraint guardianships_id_tenant_key unique (id, tenant_id);

-- 2. The member link: one account's link to one membership.
create table member_account_links (
  id                                   uuid primary key,
  tenant_id                            uuid not null references tenants(id) on delete cascade,
  user_id                              uuid not null references users(id) on delete cascade,
  member_id                            uuid not null,
  status                               text not null default 'active',
  verification_method                  text not null,
  verified_at                          timestamptz not null default now(),
  verified_by_user_id                  uuid not null,
  verified_phone                       text,
  verified_phone_verified_at           timestamptz,
  revoked_at                           timestamptz,
  revoked_by_user_id                   uuid,
  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now(),
  created_by                           uuid,
  updated_by                           uuid,

  -- 'invited' is the provisioned-but-not-yet-accepted state. The
  -- activation flips it to 'active'.
  constraint member_account_links_status_check
    check (status in ('active', 'invited', 'revoked')),
  constraint member_account_links_verification_check
    check (verification_method = 'club_record'),
  constraint member_account_links_revocation_check
    check ((status = 'revoked') = (revoked_at is not null)),
  constraint member_account_links_revoker_check
    check ((status = 'revoked') = (revoked_by_user_id is not null)),
  constraint member_account_links_verified_phone_check
    check (verified_phone is null or verified_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- A recorded number without the moment it was recorded is not
  -- representable.
  constraint member_account_links_verified_phone_pair_check
    check ((verified_phone is null) = (verified_phone_verified_at is null)),

  -- The composite-FK target key the session tables bind to. See the
  -- header: the binding must name a link that belongs to the SAME
  -- account as the session.
  constraint member_account_links_id_tenant_user_key
    unique (id, tenant_id, user_id),
  constraint member_account_links_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id)
    on delete cascade
);

create unique index member_account_links_active_member_uidx
  on member_account_links (tenant_id, member_id)
  where status in ('active', 'invited');

create unique index member_account_links_active_user_uidx
  on member_account_links (tenant_id, user_id)
  where status in ('active', 'invited');

create index member_account_links_tenant_user_idx
  on member_account_links (tenant_id, user_id, status);

create index member_account_links_tenant_verified_phone_idx
  on member_account_links (tenant_id, verified_phone)
  where status in ('active', 'invited');

alter table member_account_links enable row level security;
alter table member_account_links force row level security;

create policy tenant_isolation on member_account_links
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on member_account_links to app_user;

-- 3. The guardian link: one account's link to one CHILD, through the
--    club's guardianship row.
create table guardian_child_links (
  id                                   uuid primary key,
  tenant_id                            uuid not null references tenants(id) on delete cascade,
  user_id                              uuid not null references users(id) on delete cascade,
  guardianship_id                      uuid not null,
  member_id                            uuid,
  status                               text not null default 'active',
  verification_method                  text not null,
  verified_at                          timestamptz not null default now(),
  verified_by_user_id                  uuid not null,
  verified_phone                       text,
  verified_phone_verified_at           timestamptz,
  revoked_at                           timestamptz,
  revoked_by_user_id                   uuid,
  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now(),
  created_by                           uuid,
  updated_by                           uuid,

  constraint guardian_child_links_status_check
    check (status in ('active', 'invited', 'revoked')),
  constraint guardian_child_links_verification_check
    check (verification_method = 'club_record'),
  constraint guardian_child_links_revocation_check
    check ((status = 'revoked') = (revoked_at is not null)),
  constraint guardian_child_links_revoker_check
    check ((status = 'revoked') = (revoked_by_user_id is not null)),
  constraint guardian_child_links_verified_phone_check
    check (verified_phone is null or verified_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint guardian_child_links_verified_phone_pair_check
    check ((verified_phone is null) = (verified_phone_verified_at is null)),

  -- The same composite-FK target key as the member table.
  constraint guardian_child_links_id_tenant_user_key
    unique (id, tenant_id, user_id),
  constraint guardian_child_links_guardianship_tenant_fkey
    foreign key (guardianship_id, tenant_id)
    references guardianships (id, tenant_id) on delete cascade,
  constraint guardian_child_links_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id)
    on delete cascade
);

create unique index guardian_child_links_active_guardianship_uidx
  on guardian_child_links (tenant_id, guardianship_id)
  where status in ('active', 'invited');

create unique index guardian_child_links_active_user_uidx
  on guardian_child_links (tenant_id, user_id, guardianship_id)
  where status in ('active', 'invited');

create index guardian_child_links_tenant_user_idx
  on guardian_child_links (tenant_id, user_id, status);

create index guardian_child_links_tenant_verified_phone_idx
  on guardian_child_links (tenant_id, verified_phone)
  where status in ('active', 'invited');

create index guardian_child_links_tenant_member_idx
  on guardian_child_links (tenant_id, member_id)
  where member_id is not null;

alter table guardian_child_links enable row level security;
alter table guardian_child_links force row level security;

create policy tenant_isolation on guardian_child_links
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on guardian_child_links to app_user;
