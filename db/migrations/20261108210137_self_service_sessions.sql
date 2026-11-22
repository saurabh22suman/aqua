-- self_service_sessions
-- POSTIMAGE — db/migrations/20261108210137_self_service_sessions.sql  (candidate, NOT applied)
--
-- The purpose-scoped self-service session, its binding ledger, its
-- single-use consumption ledger and its per-account attempt budget.
--
-- PROPOSED FILENAME. The coordinator mints and validates the final name;
-- it must sort after 20261109100100.
--
-- WHAT THIS IS
--   A scoped session is a CREDENTIAL of its own. It never creates,
--   upgrades, reads or deletes a better-auth session, and it never writes
--   a ba_session row. There is no membership, no role and no permission
--   anywhere in these four tables - the authority of a scoped session is
--   derived from its own row plus the LIVE linkage rows it names, which
--   is why a role change on a membership cannot reach it.
--
-- WHY ALL FOUR TABLES CARRY ROW LEVEL SECURITY, ENABLED AND FORCED
--   These are ordinary tenant tables: every one of them carries
--   tenant_id, every one of them is scoped by app.tenant_id, and NONE of
--   them is on db/allowlist.ts::PLATFORM_TABLES. The consequence is
--   mechanical: tests/tier1/isolation.test.ts:139-160 asserts that EVERY
--   ordinary table in schema public has RLS enabled AND forced unless it
--   is in RLS_EXEMPT_TABLES. Nothing is exempted here, so no gate is
--   masked: the allowlist's own comment warns that listing a table there
--   "would land it in RLS_EXEMPT_TABLES ... a real RLS gate silently
--   masked by an allowlist entry".
--
--   THE SCOPES ARE THE REPOSITORY'S TWO SQL SCOPES, NOT NEW ONES.
--     app.tenant_id  - set by withTenant() (db/tenant.ts:10-28).
--     app.user_id    - set by withUser()   (db/tenant.ts:38-56).
--   No new session variable is introduced by this file. 20261109100300
--   adds the SECOND, user-scoped read policy in one separate, separately
--   approvable file.
--
-- WHY EVERY INDEX LEADS WITH tenant_id
--   scripts/lib/tenant-conventions-scan.ts:119-151 requires it for every
--   index on a non-platform table, and .github/workflows/ci.yml:142 runs
--   that scan on every migration at or after the 20260918050000 cutoff.
--
-- WHY THE ATTEMPT BUDGET IS TENANT-BOUND AND ACCOUNT-BOUND
--   The budget is per ACCOUNT, not per address string: `users.phone` is
--   globally unique (db/schema/users.ts:17), so an account and its
--   address are the same thing. The unique index is on
--   (tenant_id, user_id) and the address is a MIRRORED column: an
--   address-keyed row would admit a second budget for the same account
--   spelled a second way, which is exactly the bypass the E.164 CHECK
--   was meant to close and does not.
--
--   The address column is CHECK-constrained to the E.164 shape so a
--   normalised number is the only thing that can be stored: the service
--   must normalise before it reads or writes.
--
-- WHY THE SUBJECT AND THE PERSON ARE TENANT-BOUND (SX-5)
--   Every other tenant reference in this chain is composite. These two
--   were the exceptions, and they were the dangerous ones, because
--   `subject_id` is REQUIRED for a member-audience session. Two
--   composite foreign keys, MATCH SIMPLE, and one deferred trigger for
--   the consistency the foreign keys cannot express:
--     (subject_id, tenant_id) -> members (id, tenant_id)
--     (person_id,  tenant_id) -> persons (id, tenant_id)
--   A session can therefore no longer name another club's membership or
--   another club's person, and the deferred trigger refuses a session
--   whose subject member is not the person the session names.
--
-- WHY THE PERSON IS NOT NULL AND WHY IT MEANS DIFFERENT THINGS
--   The member audience's person is the MEMBER's person. The guardian
--   audience's person is the GUARDIAN's person, never the child's: the
--   guardian link's subject is a SET of child links, and the person the
--   session acts as is the adult who holds them.
--
-- WHY THERE IS A DEFERRED CONSTRAINT TRIGGER
--   A session that binds nothing is a session with no authority, and a
--   CHECK cannot see another table. The rule is enforced here by a
--   DEFERRABLE INITIALLY DEFERRED constraint trigger that runs at COMMIT,
--   by which time the binding rows exist.
--
--   ONE PRECONDITION FOLLOWS FROM THAT, AND IT IS NOT OPTIONAL: because
--   the trigger's existence check is itself RLS-scoped, the mint MUST run
--   inside withTenant() for the club the session belongs to. Under
--   withUser() the trigger would see no binding rows and refuse a
--   perfectly good mint.
--
--   THE SCOPE OF THIS RULE, STATED PLAINLY: it is enforced AT INSERT.
--   A live session that later loses its last binding is NOT caught by it
--   - closing that is the review's F-2/SX-2, whose mechanism (a BEFORE
--   DELETE guard that refuses the removal) is a human gate (FA-6), because
--   the same guard would also fire for the FK cascade and would refuse a
--   hard delete of a link row that a live session binds. Named residual.
--
-- ON DELETE CASCADE UNDER FORCE ROW LEVEL SECURITY - A RESIDUAL, NOT A FACT
--   What a cascade fired from outside a tenant scope actually does -
--   deletes the children, deletes none of them, or is refused by the
--   foreign-key check - is a Postgres-semantics question a static reading
--   cannot settle, and the three outcomes differ materially. This file
--   makes NO claim about the outcome. Named residual R-6.

-- 1. The scoped session itself.
create table self_service_sessions (
  id                       uuid primary key,
  tenant_id                uuid not null references tenants(id) on delete cascade,
  -- A real foreign key with a real cascade. Without it, deleting a users
  -- row leaves live session rows behind - including rows with revoked_at
  -- is null - and the rotation index then occupies the slot for an
  -- account that no longer exists.
  user_id                  uuid not null references users(id) on delete cascade,
  -- THE PERSON THE SESSION ACTS AS. The member's person for the member
  -- audience; the GUARDIAN's person for the guardian audience.
  person_id                uuid not null,
  audience                 text not null,
  subject_id               uuid,
  -- The equality digest over the canonical binding set. NOT an HMAC and
  -- NOT a secret: it proves the live binding set equals the bound
  -- binding set, nothing more. The guard below freezes it for the row's
  -- life, so it may be written only at insert.
  binding_digest           text not null,
  -- The stored secret is a SHA-256 of the cookie value, never the value
  -- itself. Unique, because the reader looks the row up BY this column.
  -- The guard freezes it too.
  token_hash               text not null unique,
  issued_at                timestamptz not null default now(),
  expires_at               timestamptz not null,
  last_seen_at             timestamptz not null,
  revoked_at               timestamptz,
  revoked_by_user_id       uuid,

  constraint self_service_sessions_audience_check
    check (audience in ('member', 'guardian')),
  -- The member audience is ABOUT a membership; the guardian audience is
  -- not.
  constraint self_service_sessions_subject_check
    check ((audience = 'member') = (subject_id is not null)),
  -- The stored secret is a SHA-256 in lowercase hex, never the token.
  constraint self_service_sessions_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  -- A revocation always names its actor.
  constraint self_service_sessions_revoked_check
    check (revoked_at is null or revoked_by_user_id is not null),
  -- A session that expires before it is issued is not a session.
  constraint self_service_sessions_expiry_check
    check (expires_at > issued_at),
  -- SX-5 — the subject and the person are TENANT-BOUND.
  constraint self_service_sessions_subject_tenant_fkey
    foreign key (subject_id, tenant_id) references members (id, tenant_id),
  constraint self_service_sessions_person_tenant_fkey
    foreign key (person_id, tenant_id) references persons (id, tenant_id),
  -- The composite-FK target key for the binding ledger. The audience and
  -- the account are part of the key, so a binding row cannot name a
  -- session of another audience or another account.
  constraint self_service_sessions_id_tenant_audience_user_key
    unique (id, tenant_id, audience, user_id)
);

-- THE ROTATION INDEX IS LOAD-BEARING, NOT AN OPTIMISATION
--   unique (tenant_id, user_id, audience) where revoked_at is null.
--   Without it, two concurrent mints for the same (account, club,
--   audience) can BOTH insert, and the door's "a second sign-in rotates
--   the cookie" property becomes true only by accident.
--
--   IT IS A PARTIAL UNIQUE INDEX AND THEREFORE CANNOT BE DEFERRED. The
--   mint must REVOKE-THEN-INSERT in one transaction, and its rotation
--   predicate is `revoked_at is null`, which also covers an EXPIRED but
--   unrevoked row: an expired session holds the live slot until it is
--   revoked, and the mint is what displaces it.
create unique index self_service_sessions_live_uidx
  on self_service_sessions (tenant_id, user_id, audience)
  where revoked_at is null;

create index self_service_sessions_tenant_user_idx
  on self_service_sessions (tenant_id, user_id);

-- The expiry index LEADS WITH tenant_id. The reviewed packet's
-- `create index self_service_sessions_expiry_idx on self_service_sessions
-- (expires_at)` is exactly the shape the tenant-conventions scan
-- rejects.
create index self_service_sessions_tenant_expiry_idx
  on self_service_sessions (tenant_id, expires_at);

alter table self_service_sessions enable row level security;
alter table self_service_sessions force row level security;

create policy tenant_isolation on self_service_sessions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on self_service_sessions to app_user;

-- SX-1 — A REVOCATION IS ONE-WAY, AND A SESSION ROW'S IDENTITY IS
-- IMMUTABLE.
--
-- WHY A TRIGGER AND NOT A PRIVILEGE
--   app_user holds table-level UPDATE on this table (bootstrap-roles.ts
--   :45-49 and :74-77), and UPDATE must stay: the door touches
--   last_seen_at and the revocation path sets revoked_at. The table's own
--   CHECK (revoked_at is null or revoked_by_user_id is not null) is
--   satisfied by revoked_at = null, so it constrains who must be named
--   for a revocation and nothing about whether a revocation may be
--   undone. SQL has no column privilege meaning "set it, but never unset
--   it", so the rule is a trigger.
--
-- WHY IT IS INVOKER RIGHTS (no security definer)
--   The guard reads only OLD and NEW of the row being updated. It touches
--   no table, so it needs no privilege of its own, needs no definer right,
--   and does not depend on app.tenant_id being set. It therefore holds in
--   ANY scope.
--
-- WHY IT IS DURABLE
--   A REVOKE written in a migration on a TABLE is undone at the next
--   pnpm db:deploy (bootstrap-roles.ts:45-49 re-grants blanket DML and
--   :74-77 re-applies it through ALTER DEFAULT PRIVILEGES). The same is
--   NOT true of a FUNCTION: bootstrap-roles.ts sets default privileges for
--   TABLES and SEQUENCES only, and grants no function privilege in schema
--   public. So the revoke below survives a re-bootstrap, and the trigger
--   itself is in force the moment this file is applied.
--
-- WHAT THIS GUARD DOES NOT DO (each item is a residual, not a claim)
--   * It does NOT make the session's LIFETIME a schema fact. expires_at
--     and last_seen_at stay writable, on a live row as well as on a
--     revoked one: the app role holds INSERT on this table, so the
--     mint-time expiry is an app-chosen value.
--   * It does NOT validate the revocation MOMENT. The first revocation's
--     revoked_at is whatever the writer wrote; the guard freezes that
--     value against later rewrites and nothing more.
--   * It does NOT authenticate the revocation ACTOR. revoked_by_user_id
--     has no foreign key (it is evidence, not a live reference), and the
--     guard makes it immutable.
--   * It does NOT stop a DELETE or an FK CASCADE.
create or replace function public.self_service_sessions_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- (1) A REVOCATION IS ONE-WAY, AND ITS RECORD IS FROZEN.
  --     A revoked row may not become unrevoked. Once revoked, the
  --     revocation RECORD is frozen too: it may not be cleared, moved to a
  --     different moment, or re-attributed to a different actor. Writing
  --     the same values again is allowed, so an idempotent re-revoke does
  --     not fail.
  if old.revoked_at is not null then
    if new.revoked_at is distinct from old.revoked_at then
      raise exception
        'self_service_sessions: a revoked session cannot be un-revoked (session %)', old.id
        using errcode = '23514';
    end if;
    if new.revoked_by_user_id is distinct from old.revoked_by_user_id then
      raise exception
        'self_service_sessions: a revocation cannot be re-attributed (session %)', old.id
        using errcode = '23514';
    end if;
  end if;

  -- (2) THE IDENTITY OF A SESSION ROW IS IMMUTABLE FOR ITS LIFE.
  --     A session row names one account, in one club, for one audience,
  --     acting as one person, about one membership, with one stored secret
  --     and one binding record. Rewriting any of those turns a credential
  --     into a different credential without minting a new one - and on a
  --     revoked row it would launder the revocation onto a different
  --     subject.
  --     binding_digest is in this set, not only on revoked rows: it is the
  --     equality proof over the bound set, so it may be written ONLY at
  --     insert. The ledger's own INSERT survives, so a binding row can
  --     still be added - which now makes the frozen digest MISMATCH the
  --     live set instead of matching a rewritten one. That is a
  --     fail-closed direction, and the resolver recomputes the digest over
  --     the LIVE binding set and compares it (a service obligation).
  --     expires_at and last_seen_at are deliberately NOT in this set: the
  --     touch writes last_seen_at, and the lifetime is a service
  --     parameter, not a schema fact.
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.user_id is distinct from old.user_id
     or new.audience is distinct from old.audience
     or new.token_hash is distinct from old.token_hash
     or new.binding_digest is distinct from old.binding_digest
     or new.issued_at is distinct from old.issued_at
     or new.subject_id is distinct from old.subject_id
     or new.person_id is distinct from old.person_id
  then
    raise exception
      'self_service_sessions: a session''s identity is immutable (session %)', old.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.self_service_sessions_guard_update() from public;

-- A fresh table has no trigger to drop; a drop-if-exists exists on other
-- tables only because those tables already existed. It is not needed here.
create trigger self_service_sessions_guard_update
  before update on public.self_service_sessions
  for each row execute function public.self_service_sessions_guard_update();

-- SX-5 (second half) — THE SUBJECT AND THE PERSON MUST BE THE SAME PERSON.
--
-- The two composite foreign keys above prove that the subject is a member
-- of THIS club and that the person is a person of THIS club. They cannot
-- prove that the member's person IS the session's person, because members
-- carries unique (id, tenant_id) and not unique (id, person_id,
-- tenant_id). So the last mile is a deferred trigger: it runs at COMMIT,
-- by which time the member row is locked by the same transaction that
-- wrote the session, and it refuses a session that names the wrong person.
create or replace function public.self_service_sessions_subject_person_consistent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_person uuid;
begin
  if new.audience <> 'member' then
    return null;
  end if;

  select m.person_id into v_person
    from public.members m
   where m.id = new.subject_id
     and m.tenant_id = new.tenant_id;

  if v_person is null then
    raise exception
      'self_service_sessions: subject % is not a member of this club', new.subject_id
      using errcode = '23514';
  end if;

  if v_person is distinct from new.person_id then
    raise exception
      'self_service_sessions: the subject and the person of session % are not the same person', new.id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function public.self_service_sessions_subject_person_consistent() from public;

create constraint trigger self_service_sessions_subject_person_consistent
  after insert or update on public.self_service_sessions
  deferrable initially deferred
  for each row execute function public.self_service_sessions_subject_person_consistent();

-- 2. The binding ledger: which LIVE link rows this session is bound to.
create table self_service_session_links (
  id               uuid primary key,
  session_id       uuid not null,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  audience         text not null,
  user_id          uuid not null references users(id) on delete cascade,
  member_link_id   uuid,
  guardian_link_id uuid,
  created_at       timestamptz not null default now(),

  -- THE AUDIENCE DECIDES THE LINK KIND. A member session cannot be bound
  -- to a guardian link and a guardian session cannot be bound to a member
  -- link, and exactly one of the two link columns is always set.
  constraint self_service_session_links_kind_check
    check (
      (audience = 'member'
       and member_link_id is not null
       and guardian_link_id is null)
      or
      (audience = 'guardian'
       and member_link_id is null
       and guardian_link_id is not null)
    ),
  -- The session, the club, the audience and the account must agree.
  constraint self_service_session_links_session_fkey
    foreign key (session_id, tenant_id, audience, user_id)
    references self_service_sessions (id, tenant_id, audience, user_id)
    on delete cascade,
  -- The link must belong to the SAME account in the SAME club. This is
  -- the constraint a bare uuid[] array could not express.
  constraint self_service_session_links_member_fkey
    foreign key (member_link_id, tenant_id, user_id)
    references member_account_links (id, tenant_id, user_id)
    on delete cascade,
  constraint self_service_session_links_guardian_fkey
    foreign key (guardian_link_id, tenant_id, user_id)
    references guardian_child_links (id, tenant_id, user_id)
    on delete cascade
);

-- SX-6 — THE LEDGER'S UNIQUENESS RULE. A session binds a given link row
-- at most once. A UNIQUE INDEX is enforced on INSERT AND ON UPDATE alike.
create unique index self_service_session_links_tenant_session_member_uidx
  on self_service_session_links (tenant_id, session_id, member_link_id)
  where member_link_id is not null;

create unique index self_service_session_links_tenant_session_guardian_uidx
  on self_service_session_links (tenant_id, session_id, guardian_link_id)
  where guardian_link_id is not null;

create index self_service_session_links_tenant_session_idx
  on self_service_session_links (tenant_id, session_id);

create index self_service_session_links_tenant_member_link_idx
  on self_service_session_links (tenant_id, member_link_id)
  where member_link_id is not null;

create index self_service_session_links_tenant_guardian_link_idx
  on self_service_session_links (tenant_id, guardian_link_id)
  where guardian_link_id is not null;

alter table self_service_session_links enable row level security;
alter table self_service_session_links force row level security;

create policy tenant_isolation on self_service_session_links
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on self_service_session_links to app_user;

-- 3. "A session that binds nothing binds nothing." Deferred to COMMIT,
--    because the binding rows are written after the session row.
create or replace function self_service_sessions_require_binding()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from self_service_session_links l where l.session_id = new.id
  ) then
    raise exception
      'self_service_sessions: session % must be bound to at least one link row', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function self_service_sessions_require_binding() from public;

create constraint trigger self_service_sessions_require_binding
  after insert on self_service_sessions
  deferrable initially deferred
  for each row execute function self_service_sessions_require_binding();

-- 4. The single-use ledger for an activation token. The primary key IS
--    the consume: the loser's insert conflicts and the second redeem is
--    refused, with no check-then-insert window.
create table self_service_link_uses (
  jti              text primary key,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  member_link_id   uuid,
  guardian_link_id uuid,
  used_at          timestamptz not null default now(),

  constraint self_service_link_uses_kind_check
    check (
      (member_link_id is not null and guardian_link_id is null)
      or
      (member_link_id is null and guardian_link_id is not null)
    ),
  -- The consumed link belongs to the SAME account in the SAME club.
  constraint self_service_link_uses_member_fkey
    foreign key (member_link_id, tenant_id, user_id)
    references member_account_links (id, tenant_id, user_id)
    on delete cascade,
  constraint self_service_link_uses_guardian_fkey
    foreign key (guardian_link_id, tenant_id, user_id)
    references guardian_child_links (id, tenant_id, user_id)
    on delete cascade
);

create index self_service_link_uses_tenant_user_idx
  on self_service_link_uses (tenant_id, user_id);

create index self_service_link_uses_tenant_member_link_idx
  on self_service_link_uses (tenant_id, member_link_id)
  where member_link_id is not null;

create index self_service_link_uses_tenant_guardian_link_idx
  on self_service_link_uses (tenant_id, guardian_link_id)
  where guardian_link_id is not null;

alter table self_service_link_uses enable row level security;
alter table self_service_link_uses force row level security;

create policy tenant_isolation on self_service_link_uses
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on self_service_link_uses to app_user;

-- 5. The per-account attempt budget behind the self PIN door.
--
--    THE GRANT IS NOT WRITTEN HERE AS A REVOKE, BECAUSE A REVOKE IN A
--    MIGRATION IS NOT DURABLE: db/bootstrap-roles.ts:45-49 grants blanket
--    DML on every table in schema public and :66-77 re-applies it through
--    ALTER DEFAULT PRIVILEGES, so a migration's own REVOKE is undone at
--    the next `pnpm db:deploy`. The durable mechanism is
--    db/app-privileges.ts's restrictAppPrivileges().
--
--    The counter counts EVERY attempt, including successful ones: the
--    API contract says "20 attempts per 15 minutes", not "20 failures".
create table self_service_login_attempts (
  id                 uuid primary key,
  tenant_id          uuid not null references tenants(id) on delete cascade,
  user_id            uuid not null references users(id) on delete cascade,
  -- A MIRROR of the account's canonical number, not a key.
  address            text not null,
  window_started_at  timestamptz not null default now(),
  attempts           integer not null default 0,

  constraint self_service_login_attempts_attempts_check
    check (attempts >= 0),
  -- Only a normalised number may be recorded, or the same account could
  -- be given a fresh budget by retyping its number in another format.
  constraint self_service_login_attempts_address_check
    check (address ~ '^\+[1-9][0-9]{7,14}$')
);

-- SX-4 — the budget is keyed on the ACCOUNT. The address is a mirrored
-- column, so a second spelling of the same number cannot mint a second
-- budget row for the same account.
create unique index self_service_login_attempts_tenant_user_uidx
  on self_service_login_attempts (tenant_id, user_id);

create index self_service_login_attempts_tenant_user_idx
  on self_service_login_attempts (tenant_id, user_id);

alter table self_service_login_attempts enable row level security;
alter table self_service_login_attempts force row level security;

create policy tenant_isolation on self_service_login_attempts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update on self_service_login_attempts to app_user;
