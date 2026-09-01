-- platform_users
--
-- Platform staff (Aqua operators, not tenant users). Separate from `users`:
-- the platform_users table is NOT reachable through better-auth's tenant login,
-- has no link to tenant_memberships, and lives outside the tenant RLS scope.
-- Mandatory 2FA for every platform user (see lib/services/platform-auth.ts).
-- No RLS — this is platform-level data and is reached only via withPlatform().

create table platform_users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  name            text not null,
  password_hash   text not null,                       -- scrypt; see lib/services/platform-auth.ts
  password_salt   text not null,                       -- scrypt salt (hex)
  totp_secret     text,                                -- encrypted base32; null until enrollment
  totp_enrolled   boolean not null default false,
  backup_codes    text[]             default '{}',      -- one-time recovery codes (hashed)
  role            text not null default 'admin',       -- admin | viewer
  status          text not null default 'active',      -- active | suspended
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint platform_users_role_check   check (role in ('admin', 'viewer')),
  constraint platform_users_status_check check (status in ('active', 'suspended'))
);

-- Sessions are issued on password verification, then promoted to "fully
-- authenticated" only after the second factor is presented. The cookie
-- carries an opaque session id; the row is the source of truth for both
-- state and expiry. Token in the row is stored hashed (sha256); the raw
-- token never lives anywhere durable.
create table platform_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references platform_users(id) on delete cascade,
  token_hash            text not null unique,
  ip_address            inet,
  user_agent            text,
  second_factor_passed  boolean not null default false,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  last_seen_at          timestamptz not null default now()
);

create index platform_sessions_user_id_idx on platform_sessions (user_id);
create index platform_sessions_expires_at_idx on platform_sessions (expires_at);

-- Audit trail for platform admin actions. Same shape as audit_log on the
-- tenant side (architecture.md §8.10) but lives at platform scope because
-- platform users do not belong to any tenant. No RLS — reached only via
-- withPlatform(). Append-only; insert grant, no update/delete grant.
create table platform_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references platform_users(id),
  tenant_id   uuid,                                   -- nullable; not every action targets a tenant
  action      text not null,                          -- e.g. 'tenant.suspend', 'platform_user.create'
  target_type text,                                   -- e.g. 'tenant', 'platform_user'
  target_id   uuid,
  detail      jsonb not null default '{}',
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index platform_audit_log_created_at_idx on platform_audit_log (created_at desc);
create index platform_audit_log_actor_id_idx on platform_audit_log (actor_id);
create index platform_audit_log_tenant_id_idx on platform_audit_log (tenant_id) where tenant_id is not null;

-- Same grant split as tenant-side audit_log: app_user can insert, cannot
-- select/update/delete directly. Reads go through the service which calls
-- withPlatform() and is the only sanctioned path.
grant insert on platform_audit_log to app_user;
