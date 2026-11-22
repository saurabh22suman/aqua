-- showcase_local
-- PROPOSED_showcase_local.sql
--
-- THE SHOWCASE LEDGER — two tables, one sequence, five triggers, two
-- tenant policies and the privilege reconcile.
--
-- COORDINATOR: THIS FILE IS NOT A MIGRATION YET. Write it to
-- db/migrations/<timestamp>_showcase_local.sql (pnpm db:new-migration
-- showcase_local) and let the runner stamp the legal timestamp. Never
-- edit an applied migration, and never reuse an old timestamp.
--
-- NOTHING HERE HAS BEEN APPLIED. No SQL was run against any database.
--
-- WHAT CHANGED FROM THE 2026-11-09 CANDIDATE'S PROPOSED SQL
-- -------------------------------------------------------
-- 1. showcase_decisions carries the IDENTITY each decision was made
--    through: decider_user_id (the authenticated account) and exactly
--    one of member_link_id / guardian_link_id (the exact linkage row).
--    The read needs them to ask whether that identity is still CURRENT.
--
-- 2. A NEW TRIGGER, showcase_decisions_source, refuses a decision row
--    whose source link does not belong to that account in that club for
--    that member. It is a trigger and not a foreign key on purpose: a
--    foreign key would either block the account deletion that cascades
--    to the link rows, or take the ledger row with it. The link's
--    DISAPPEARANCE is what the read treats as "the identity is no longer
--    current".
--
-- 3. THE RAISE MESSAGES WERE BROKEN. The candidate's messages passed the
--    row id as an extra RAISE argument with no % placeholder in the
--    format string, which PostgreSQL rejects with "too many parameters
--    specified for RAISE" — the intended message never reached the log.
--    The messages below carry the id in a placeholder.
--
-- ---------------------------------------------------------------------------
-- 1. THE PROFILE — the member's page: who it is, and the name it shows.
--
-- There is NO visibility column. Visibility is derived from the live
-- decisions at read time (lib/services/showcase/visibility.ts), so a
-- member's own veto and a later permit restore the page with no write
-- at all, and a guardian's revocation takes it down with no write at
-- all either.
-- ---------------------------------------------------------------------------
create table showcase_profiles (
  id                uuid primary key,
  tenant_id         uuid not null references tenants(id) on delete cascade,
  member_id         uuid not null,
  subject_person_id uuid not null,
  chosen_name       text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint showcase_profiles_chosen_name_check
    check (char_length(chosen_name) between 1 and 60),
  unique (tenant_id, member_id),
  unique (id, tenant_id),
  foreign key (member_id, tenant_id) references members (id, tenant_id),
  foreign key (subject_person_id, tenant_id) references persons (id, tenant_id)
);

create index showcase_profiles_tenant_member_idx
  on showcase_profiles (tenant_id, member_id);

alter table showcase_profiles enable row level security;
alter table showcase_profiles force row level security;

create policy tenant_isolation on showcase_profiles
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 2. THE LEDGER — append-only. One row per decision, forever.
--
-- `decision_seq` is the ORDERING TOKEN and `created_at` is the CLOCK.
-- Both are stamped by the database at insert time (section 4). The
-- application sends neither, so "which decision came later" is a
-- statement about call order and not about wall-clock luck.
--
-- `decider_role` is DERIVED by the writer from the authenticated scope.
-- The check below makes the one thing that must always be true
-- mechanical: a SUBJECT's decision is BY the subject.
--
-- THE IDENTITY COLUMNS
--   decider_user_id  — the authenticated account (scope.userId).
--   member_link_id   — the exact member_account_links row, for a
--                      decision the member made about themself.
--   guardian_link_id — the exact guardian_child_links row, for a
--                      decision a linked guardian made.
--   Exactly one of the two link columns is set, and the CHECK says
--   which. There is NO foreign key on either of them, and NO foreign
--   key on decider_user_id: the linkage rows carry the constraint (see
--   section 4b), and `users` is the global platform table that the
--   repository's rule of record says is never queried directly.
-- ---------------------------------------------------------------------------
create table showcase_decisions (
  id                uuid primary key,
  tenant_id         uuid not null references tenants(id) on delete cascade,
  member_id         uuid not null,
  subject_person_id uuid not null,
  decider_person_id uuid not null,
  decider_user_id   uuid not null,
  member_link_id    uuid,
  guardian_link_id  uuid,
  decider_role      text not null,
  decision          text not null,
  decision_seq      bigint not null,
  created_at        timestamptz not null,
  constraint showcase_decisions_decision_check
    check (decision in ('approve','revoke','no','permit')),
  constraint showcase_decisions_decider_role_check
    check (decider_role in ('subject','guardian')),
  constraint showcase_decisions_subject_self_check
    check (decider_role = 'guardian' or decider_person_id = subject_person_id),
  constraint showcase_decisions_source_link_check
    check (
      (decider_role = 'subject'
       and member_link_id is not null
       and guardian_link_id is null)
      or
      (decider_role = 'guardian'
       and guardian_link_id is not null
       and member_link_id is null)
    ),
  foreign key (member_id, tenant_id) references members (id, tenant_id),
  foreign key (subject_person_id, tenant_id) references persons (id, tenant_id),
  foreign key (decider_person_id, tenant_id) references persons (id, tenant_id)
);

create index showcase_decisions_tenant_member_seq_idx
  on showcase_decisions (tenant_id, member_id, decision_seq);

-- THE PER-DECIDER PROBE: the latest decision of ONE decider person. The
-- corrected read uses this index, because the rule is "the latest
-- decision PER DECIDER PERSON", never "the latest decision of anybody".
create index showcase_decisions_tenant_member_decider_seq_idx
  on showcase_decisions (tenant_id, member_id, decider_person_id, decision_seq);

alter table showcase_decisions enable row level security;
alter table showcase_decisions force row level security;

create policy tenant_isolation on showcase_decisions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 3. THE ORDERING TOKEN.
--
-- CACHE 1 is load-bearing, not decoration. A larger cache lets the
-- server hand out a block of values per session, and two sessions can
-- then be given values whose NUMERIC order does not match their CALL
-- order. The whole "later permit" argument depends on call order, so
-- the sequence must hand out one value at a time, under its own lock.
--
-- The WRITER also serialises the decision transactions for one member
-- with a bounded advisory lock, so that the sequence order and the
-- commit order agree for one member's decisions.
-- ---------------------------------------------------------------------------
create sequence showcase_decisions_seq as bigint cache 1;

-- The ledger's size is not the application's business. The stamping
-- function below is SECURITY DEFINER, so it can still use the sequence.
revoke all on sequence showcase_decisions_seq from public;
revoke all on sequence public.showcase_decisions_seq from app_user;

-- ---------------------------------------------------------------------------
-- 4. THE TRIGGERS.
--
-- 4a. THE STAMP. The database owns the clock and the ordering token.
--     It overwrites both unconditionally, so no caller can back-date a
--     row or pre-allocate an ordering number. There is NO default on
--     `created_at` and NO default on `decision_seq`: if this trigger
--     were missing, the insert would fail on the NOT NULL constraint
--     instead of quietly falling back to a second clock.
-- ---------------------------------------------------------------------------
create function showcase_decisions_stamp_insert() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
begin
  new.created_at   := statement_timestamp();
  new.decision_seq := nextval('public.showcase_decisions_seq');
  return new;
end;
$$;

revoke all on function showcase_decisions_stamp_insert() from public;
grant execute on function showcase_decisions_stamp_insert() to app_user;

create trigger showcase_decisions_stamp
  before insert on showcase_decisions
  for each row execute function showcase_decisions_stamp_insert();

-- ---------------------------------------------------------------------------
-- 4b. THE SOURCE BINDING. The decision names the EXACT linkage row it
--     was made through, and the database refuses a row whose link does
--     not belong to that account in that club for that member.
--
--     IT IS A TRIGGER AND NOT A FOREIGN KEY, ON PURPOSE.
--       The linkage rows are deleted when the account is deleted (the
--       account's own cascade). A foreign key with ON DELETE CASCADE
--       would take the LEDGER ROW with it and destroy the append-only
--       record; a foreign key with ON DELETE RESTRICT would make the
--       account undeletable. The member lane already hit this exact
--       trade-off for the staff confirmer id (db/schema/member-self.ts:
--       "a foreign key with on delete set null would make the
--       quartet-together CHECK below unsatisfiable by the FK's own
--       action, and a platform user delete would then fail").
--
--       So the binding is checked on INSERT, and the link's later
--       DISAPPEARANCE is what the read treats as "the identity is no
--       longer current": a revoked account link, a lost account identity
--       confirmation, a deleted account.
--
--     The function is SECURITY DEFINER so it can read the linkage rows
--     under the migration role. It runs inside the caller's tenant
--     transaction, so the tenant policy sees the right tenant.
-- ---------------------------------------------------------------------------
create function showcase_decisions_check_source() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
begin
  if new.decider_role = 'subject' then
    if not exists (
      select 1
      from member_account_links l
      where l.id = new.member_link_id
        and l.tenant_id = new.tenant_id
        and l.user_id = new.decider_user_id
        and l.member_id = new.member_id
    ) then
      raise exception
        'showcase_decisions: the source member link (%) does not match the tenant, the account and the member',
        new.id;
    end if;
  else
    if not exists (
      select 1
      from guardian_child_links l
      where l.id = new.guardian_link_id
        and l.tenant_id = new.tenant_id
        and l.user_id = new.decider_user_id
        and l.member_id = new.member_id
    ) then
      raise exception
        'showcase_decisions: the source guardian link (%) does not match the tenant, the account and the member',
        new.id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function showcase_decisions_check_source() from public;
grant execute on function showcase_decisions_check_source() to app_user;

create trigger showcase_decisions_source
  before insert on showcase_decisions
  for each row execute function showcase_decisions_check_source();

-- ---------------------------------------------------------------------------
-- 4c. NO MUTATION. A ledger row is never rewritten and never removed by
--     the application. The check is on the ROLE, not on a session
--     variable: there is NO app-settable bypass GUC here, and there
--     cannot be one, because the only way through is to BE the table's
--     owner.
--
--     The privileged fixture cleanup works exactly because of that: the
--     migration role owns the tables, so the dedicated test cleanup can
--     delete its own rows, while the application role can do neither.
--
--     A referential cascade (the tenant delete) runs inside the RI
--     trigger — depth > 1 — and is not the application choosing to
--     erase a decision, so it is allowed through.
-- ---------------------------------------------------------------------------
create function showcase_decisions_refuse_mutation() returns trigger as $$
declare
  owner_name text;
begin
  if tg_op = 'UPDATE' then
    raise exception
      'showcase_decisions: the decision ledger is append-only; a row (%) may not be updated',
      old.id;
  end if;

  select r.rolname into owner_name
    from pg_class c
    join pg_roles r on r.oid = c.relowner
   where c.oid = tg_relid;

  if pg_trigger_depth() > 1 then
    return old;
  end if;

  if current_user <> owner_name then
    raise exception
      'showcase_decisions: the decision ledger is append-only; a row (%) may not be deleted',
      old.id;
  end if;

  return old;
end;
$$ language plpgsql;

create trigger showcase_decisions_no_mutation
  before update or delete on showcase_decisions
  for each row execute function showcase_decisions_refuse_mutation();

-- ---------------------------------------------------------------------------
-- 4d. THE PROFILE IS WRITTEN ONCE. The chosen name is chosen at the
--     first setup and is never edited and never silently reset. There is
--     no editing surface in this slice, and the database says so too.
-- ---------------------------------------------------------------------------
create function showcase_profiles_refuse_mutation() returns trigger as $$
declare
  owner_name text;
begin
  if tg_op = 'UPDATE' then
    raise exception
      'showcase_profiles: the chosen name is chosen once; a row (%) may not be updated',
      old.id;
  end if;

  select r.rolname into owner_name
    from pg_class c
    join pg_roles r on r.oid = c.relowner
   where c.oid = tg_relid;

  if pg_trigger_depth() > 1 then
    return old;
  end if;

  if current_user <> owner_name then
    raise exception
      'showcase_profiles: a row (%) may not be deleted',
      old.id;
  end if;

  return old;
end;
$$ language plpgsql;

create trigger showcase_profiles_no_mutation
  before update or delete on showcase_profiles
  for each row execute function showcase_profiles_refuse_mutation();

-- ---------------------------------------------------------------------------
-- 5. THE PRIVILEGES.
--
-- The application role may READ and APPEND. It may never rewrite or
-- remove a row of either table.
--
-- THIS REVOKE MUST ALSO LIVE IN db/app-privileges.ts. The blanket grant
-- in db/bootstrap-roles.ts gives app_user select/insert/update/delete on
-- every table, and ALTER DEFAULT PRIVILEGES re-applies it to every table
-- created later — so a migration-only revoke is undone on the next
-- deploy. The reconcile re-issues it on every deploy.
-- ---------------------------------------------------------------------------
revoke update, delete on public.showcase_profiles from app_user;
revoke update, delete on public.showcase_decisions from app_user;
