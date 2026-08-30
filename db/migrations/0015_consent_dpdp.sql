-- C-05 (Consent — DPDP). Proposed and reviewed before building (children's
-- data). Three tables: guardianships (C-02, a real prerequisite C-06's own
-- done-when needs, even though the plan's Depends field only recently
-- gained this citation), policy_versions (platform-level, immutable text
-- per version — a version LABEL with no text behind it is unverifiable to
-- a regulator, and cannot be reconstructed retroactively), and consents
-- itself.

create table guardianships (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  minor_id     uuid not null,
  guardian_id  uuid not null,
  relationship text not null,
  is_primary   boolean not null default false,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  unique (tenant_id, minor_id, guardian_id),
  foreign key (minor_id, tenant_id) references persons (id, tenant_id),
  foreign key (guardian_id, tenant_id) references persons (id, tenant_id)
);

create index on guardianships (tenant_id, minor_id) where deleted_at is null;

alter table guardianships enable row level security;
alter table guardianships force row level security;

create policy tenant_isolation on guardianships
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Platform-level, not tenant-scoped: this is OUR standard consent notice
-- shown to every guardian/adult member across every tenant, not a
-- per-tenant document (that's C-05a's separate operator-facing DPA,
-- us <-> tenant, not tenant <-> guardian). No RLS -- same shape as
-- plans/features.
create table policy_versions (
  version         text primary key,
  content         text not null,
  effective_from  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table consents (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  person_id       uuid not null,
  purpose         text not null,
  granted_by      uuid not null,
  -- Staff member who facilitated/witnessed capture, distinct from who
  -- consented -- null for self-service (no one facilitated). Bare user
  -- id, no FK: staff (C-04) doesn't exist yet, same shape and same
  -- reasoning as batches.coach_id/sessions.coach_id (migration 0014).
  witnessed_by_user_id uuid,
  policy_version  text not null references policy_versions(version),
  granted_at      timestamptz not null default now(),
  withdrawn_at    timestamptz,
  evidence        jsonb not null,
  created_at      timestamptz not null default now(),
  check (purpose in ('processing', 'photography', 'communications')),
  foreign key (person_id, tenant_id) references persons (id, tenant_id),
  foreign key (granted_by, tenant_id) references persons (id, tenant_id)
);

-- At most one ACTIVE grant per (tenant, person, purpose) at a time.
-- Without this, "what's the current state for this purpose" is "whichever
-- row has the latest granted_at" -- a convention, not a guarantee. A
-- re-grant after a withdrawal is a NEW row; the old one stays withdrawn
-- forever.
create unique index consents_one_active_grant
  on consents (tenant_id, person_id, purpose)
  where withdrawn_at is null;

create index on consents (tenant_id, person_id);

alter table consents enable row level security;
alter table consents force row level security;

create policy tenant_isolation on consents
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Immutability as a database constraint, not an application-layer
-- promise someone can forget: the only permitted change to an existing
-- row, ever, is withdrawn_at going from null to a timestamp, exactly
-- once. Every other field -- including a withdrawn row's own
-- withdrawn_at -- is frozen the moment the row exists. A regulator
-- asking "could this have been altered after the fact" gets "no,
-- mechanically" instead of "we don't update those rows, trust us."
create function consents_enforce_immutability() returns trigger as $$
begin
  if old.withdrawn_at is not null then
    raise exception 'consents: row % already withdrawn at %, no further changes permitted', old.id, old.withdrawn_at;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.person_id is distinct from old.person_id
     or new.purpose is distinct from old.purpose
     or new.granted_by is distinct from old.granted_by
     or new.witnessed_by_user_id is distinct from old.witnessed_by_user_id
     or new.policy_version is distinct from old.policy_version
     or new.granted_at is distinct from old.granted_at
     or new.evidence is distinct from old.evidence
     or new.id is distinct from old.id then
    raise exception 'consents: only withdrawn_at (null -> timestamp) may be set on an existing row; every other field is immutable';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger consents_immutable
  before update on consents
  for each row execute function consents_enforce_immutability();
