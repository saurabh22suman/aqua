-- 20261025234623_mock_gate_access
--
-- Mock-only gate access backend (docs/mock-access.md). Three
-- tenant-scoped tables:
--
--   gate_devices      — the physical gates. One row per gate, named by a
--                       tenant-local key ("main", "court1", "court2").
--                       A gate either sits at a location (the premises
--                       gate: accepts a PIN or an RFID tag) or is bound to
--                       a facility / sub-unit (a court gate: RFID only).
--                       The binding is what keeps one member's booking
--                       from opening every court.
--   gate_credentials  — a member's gate credential (a PIN or an RFID
--                       tag). ONLY a keyed HMAC digest is stored; the raw
--                       secret is never persisted, logged or audited.
--   gate_access_events— the idempotent scan log. One row per device
--                       event, unique on (tenant_id, device_id,
--                       client_event_id) so a replayed event returns the
--                       stored decision instead of creating a second
--                       one.
--
-- Shape decisions:
--   * tenant-leading unique keys and indexes, composite (id, tenant_id)
--     foreign keys, RLS enable + force, the standard nullif
--     tenant_isolation policy — the house shape.
--   * ids are supplied by the application (uuidv7); no
--     `default gen_random_uuid()` in a new migration.
--   * reason_code is a closed set, enforced by a CHECK constraint, so a
--     typo cannot become an unrecognised "denied" the door cannot
--     explain.
--   * an override always carries a reason and an actor: the
--     `(reason_code = 'granted_manual_override') = (override_reason is
--     not null)` constraint plus the decided_by check make a silent
--     manual grant impossible at the database level.
--   * no platform_admin policies: gate devices, credentials and access
--     events are tenant operations data. The platform operator has no
--     legitimate path to a member's credential or access log.

create table gate_devices (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  location_id  uuid not null,
  device_key   text not null,
  label        text not null,
  facility_id  uuid,
  sub_unit_id  uuid,
  accepts_pin  boolean not null default false,
  accepts_rfid boolean not null default false,
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint gate_devices_id_tenant_key unique (id, tenant_id),
  constraint gate_devices_tenant_key_key unique (tenant_id, device_key),
  constraint gate_devices_status_check check (status in ('active', 'disabled')),
  constraint gate_devices_methods_check check (accepts_pin or accepts_rfid),
  constraint gate_devices_key_check check (device_key ~ '^[a-z0-9_-]{1,32}$'),
  constraint gate_devices_label_check check (char_length(label) between 1 and 120),
  constraint gate_devices_scope_check
    check (sub_unit_id is null or facility_id is not null),
  constraint gate_devices_location_tenant_fkey
    foreign key (location_id, tenant_id) references locations(id, tenant_id) on delete cascade,
  constraint gate_devices_facility_tenant_fkey
    foreign key (facility_id, tenant_id) references facilities(id, tenant_id),
  constraint gate_devices_sub_unit_tenant_fkey
    foreign key (sub_unit_id, tenant_id) references facility_sub_units(id, tenant_id)
);

create index gate_devices_tenant_location_idx
  on gate_devices (tenant_id, location_id);

create table gate_credentials (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  member_id   uuid not null,
  kind        text not null,
  secret_hash text not null,
  label       text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint gate_credentials_id_tenant_key unique (id, tenant_id),
  constraint gate_credentials_tenant_kind_hash_key
    unique (tenant_id, kind, secret_hash),
  constraint gate_credentials_kind_check check (kind in ('pin', 'rfid')),
  constraint gate_credentials_status_check check (status in ('active', 'revoked')),
  constraint gate_credentials_hash_check check (secret_hash ~ '^[0-9a-f]{64}$'),
  constraint gate_credentials_label_check
    check (label is null or char_length(label) <= 120),
  constraint gate_credentials_member_tenant_fkey
    foreign key (member_id, tenant_id) references members(id, tenant_id) on delete cascade
);

create index gate_credentials_tenant_member_idx
  on gate_credentials (tenant_id, member_id);

create table gate_access_events (
  id                    uuid primary key,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  device_id             uuid not null,
  member_id             uuid,
  credential_id         uuid,
  credential_fingerprint text,
  method                text not null,
  decision              text not null,
  reason_code           text not null,
  basis                 text,
  override_reason       text,
  decided_by            uuid,
  occurred_at           timestamptz not null,
  client_event_id       text not null,
  created_at            timestamptz not null default now(),
  constraint gate_access_events_id_tenant_key unique (id, tenant_id),
  constraint gate_access_events_tenant_device_event_key
    unique (tenant_id, device_id, client_event_id),
  constraint gate_access_events_method_check
    check (method in ('pin', 'rfid', 'override')),
  constraint gate_access_events_decision_check
    check (decision in ('granted', 'denied')),
  -- A grant and its reason must agree. The log cannot hold a row that
  -- says "granted" with a denial reason (or the reverse).
  constraint gate_access_events_decision_reason_check
    check ((decision = 'granted') = (reason_code in (
      'granted_booking', 'granted_membership', 'granted_manual_override'
    ))),
  constraint gate_access_events_basis_check
    check (basis is null or basis in ('booking', 'membership', 'override')),
  constraint gate_access_events_fingerprint_check
    check (method = 'override' or credential_fingerprint is not null),
  constraint gate_access_events_fingerprint_shape_check
    check (credential_fingerprint is null or credential_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint gate_access_events_override_check
    check ((reason_code = 'granted_manual_override') = (override_reason is not null)),
  constraint gate_access_events_override_actor_check
    check (reason_code <> 'granted_manual_override' or decided_by is not null),
  constraint gate_access_events_override_reason_check
    check (override_reason is null or char_length(override_reason) between 3 and 500),
  constraint gate_access_events_reason_check check (reason_code in (
    'granted_booking',
    'granted_membership',
    'granted_manual_override',
    'denied_device_disabled',
    'denied_method_not_accepted',
    'denied_unknown_device',
    'denied_unknown_credential',
    'denied_credential_revoked',
    'denied_member_inactive',
    'denied_no_active_booking',
    'denied_not_booked_here',
    'denied_membership_paused',
    'denied_membership_expired',
    'denied_membership_not_applicable',
    'denied_no_membership',
    'denied_event_conflict'
  )),
  constraint gate_access_events_device_tenant_fkey
    foreign key (device_id, tenant_id) references gate_devices(id, tenant_id) on delete cascade,
  constraint gate_access_events_member_tenant_fkey
    foreign key (member_id, tenant_id) references members(id, tenant_id),
  -- The one single-column foreign key in this lane. Every other tenant
  -- foreign key is composite (id, tenant_id), because SET NULL on a
  -- composite key would also null the NOT NULL tenant_id. The
  -- credential id therefore comes from a tenant-scoped lookup and can
  -- only ever point at a credential of this tenant; RLS governs what a
  -- reader can see of the row itself.
  constraint gate_access_events_credential_fkey
    foreign key (credential_id) references gate_credentials(id) on delete set null
);

create index gate_access_events_tenant_device_time_idx
  on gate_access_events (tenant_id, device_id, occurred_at desc);

create index gate_access_events_tenant_member_time_idx
  on gate_access_events (tenant_id, member_id, occurred_at desc);

alter table gate_devices enable row level security;
alter table gate_devices force row level security;

create policy tenant_isolation on gate_devices
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on gate_devices to app_user;

alter table gate_credentials enable row level security;
alter table gate_credentials force row level security;

create policy tenant_isolation on gate_credentials
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on gate_credentials to app_user;

alter table gate_access_events enable row level security;
alter table gate_access_events force row level security;

create policy tenant_isolation on gate_access_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The access log is append-only, like the other tenant logs in this
-- repository (activity_events, audit_log, announcements): the
-- application role may add a row and read it, and may not rewrite or
-- remove one. The default privileges granted update and delete when the
-- table was created, so they are revoked explicitly here.
grant select, insert on gate_access_events to app_user;
revoke update, delete on gate_access_events from app_user;
