import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { locations } from "./locations";
import { facilities, facilitySubUnits } from "./preset-engine";
import { members } from "./people";
import type { MemberId, TenantId } from "@/lib/ids";

// Mock-only gate access (docs/mock-access.md). The typed access layer
// for the three tables created in
// db/migrations/20261025234623_mock_gate_access.sql.
//
// The shapes mirror the migration exactly — the migration is the
// schema, this file is the typed view of it:
//
//   gate_devices      — the gates themselves. `device_key` is the
//                       tenant-local name ("main", "court1", "court2").
//                       A gate with a `facilityId`/`subUnitId` is bound
//                       to that court; a gate without one is the
//                       premises gate. The binding is what stops one
//                       member's booking from opening every court.
//   gate_credentials  — a member's PIN or RFID tag. ONLY the keyed
//                       HMAC digest is stored: `secretHash` is never
//                       the raw secret, and the raw secret is never
//                       written to a log, an audit row or a message.
//   gate_access_events— the idempotent scan log. Unique on
//                       (tenantId, deviceId, clientEventId): a replayed
//                       device event returns the stored decision
//                       instead of writing a second row.
//
// The RLS posture (tenant_isolation, enable + force, nullif shape) is
// identical to the other tenant-scoped tables in this repo.

export const GATE_DEVICE_STATUSES = ["active", "disabled"] as const;
export type GateDeviceStatus = (typeof GATE_DEVICE_STATUSES)[number];

export const GATE_CREDENTIAL_KINDS = ["pin", "rfid"] as const;
export type GateCredentialKind = (typeof GATE_CREDENTIAL_KINDS)[number];

export const GATE_CREDENTIAL_STATUSES = ["active", "revoked"] as const;
export type GateCredentialStatus = (typeof GATE_CREDENTIAL_STATUSES)[number];

export const gateDevices = pgTable(
  "gate_devices",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    deviceKey: text("device_key").notNull(),
    label: text("label").notNull(),
    facilityId: uuid("facility_id"),
    subUnitId: uuid("sub_unit_id"),
    acceptsPin: boolean("accepts_pin").notNull().default(false),
    acceptsRfid: boolean("accepts_rfid").notNull().default(false),
    status: text("status").notNull().default("active").$type<GateDeviceStatus>(),
    ...auditColumns,
  },
  (t) => [
    unique("gate_devices_id_tenant_key").on(t.id, t.tenantId),
    unique("gate_devices_tenant_key_key").on(t.tenantId, t.deviceKey),
    check(
      "gate_devices_status_check",
      sql`${t.status} in ('active', 'disabled')`,
    ),
    check("gate_devices_methods_check", sql`${t.acceptsPin} or ${t.acceptsRfid}`),
    check(
      "gate_devices_key_check",
      sql`${t.deviceKey} ~ '^[a-z0-9_-]{1,32}$'`,
    ),
    check(
      "gate_devices_label_check",
      sql`char_length(${t.label}) between 1 and 120`,
    ),
    check(
      "gate_devices_scope_check",
      sql`${t.subUnitId} is null or ${t.facilityId} is not null`,
    ),
    foreignKey({
      name: "gate_devices_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "gate_devices_facility_tenant_fkey",
      columns: [t.facilityId, t.tenantId],
      foreignColumns: [facilities.id, facilities.tenantId],
    }),
    foreignKey({
      name: "gate_devices_sub_unit_tenant_fkey",
      columns: [t.subUnitId, t.tenantId],
      foreignColumns: [facilitySubUnits.id, facilitySubUnits.tenantId],
    }),
    index("gate_devices_tenant_location_idx").on(t.tenantId, t.locationId),
  ],
);

export const gateCredentials = pgTable(
  "gate_credentials",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    kind: text("kind").notNull().$type<GateCredentialKind>(),
    // Keyed HMAC-SHA256 digest of the presented secret. Never the raw
    // PIN, never the raw tag: see lib/services/mock-access/secret.ts.
    secretHash: text("secret_hash").notNull(),
    label: text("label"),
    status: text("status")
      .notNull()
      .default("active")
      .$type<GateCredentialStatus>(),
    ...auditColumns,
  },
  (t) => [
    unique("gate_credentials_id_tenant_key").on(t.id, t.tenantId),
    unique("gate_credentials_tenant_kind_hash_key").on(
      t.tenantId,
      t.kind,
      t.secretHash,
    ),
    check(
      "gate_credentials_kind_check",
      sql`${t.kind} in ('pin', 'rfid')`,
    ),
    check(
      "gate_credentials_status_check",
      sql`${t.status} in ('active', 'revoked')`,
    ),
    check(
      "gate_credentials_hash_check",
      sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "gate_credentials_label_check",
      sql`${t.label} is null or char_length(${t.label}) <= 120`,
    ),
    foreignKey({
      name: "gate_credentials_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }).onDelete("cascade"),
    index("gate_credentials_tenant_member_idx").on(t.tenantId, t.memberId),
  ],
);

export const gateAccessEvents = pgTable(
  "gate_access_events",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    deviceId: uuid("device_id").notNull(),
    memberId: uuid("member_id").$type<MemberId>(),
    credentialId: uuid("credential_id"),
    // The digest of the presented secret, so a replayed event can be
    // matched to the event it replays without storing the secret.
    credentialFingerprint: text("credential_fingerprint"),
    method: text("method").notNull(),
    decision: text("decision").notNull(),
    reasonCode: text("reason_code").notNull(),
    basis: text("basis"),
    overrideReason: text("override_reason"),
    decidedBy: uuid("decided_by"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    clientEventId: text("client_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gate_access_events_id_tenant_key").on(t.id, t.tenantId),
    unique("gate_access_events_tenant_device_event_key").on(
      t.tenantId,
      t.deviceId,
      t.clientEventId,
    ),
    check(
      "gate_access_events_method_check",
      sql`${t.method} in ('pin', 'rfid', 'override')`,
    ),
    check(
      "gate_access_events_decision_check",
      sql`${t.decision} in ('granted', 'denied')`,
    ),
    // A grant and its reason must agree: the log cannot hold a row
    // that says "granted" with a denial reason (or the reverse).
    check(
      "gate_access_events_decision_reason_check",
      sql`(${t.decision} = 'granted') = (${t.reasonCode} in ('granted_booking', 'granted_membership', 'granted_manual_override'))`,
    ),
    check(
      "gate_access_events_basis_check",
      sql`${t.basis} is null or ${t.basis} in ('booking', 'membership', 'override')`,
    ),
    check(
      "gate_access_events_fingerprint_check",
      sql`${t.method} = 'override' or ${t.credentialFingerprint} is not null`,
    ),
    check(
      "gate_access_events_fingerprint_shape_check",
      sql`${t.credentialFingerprint} is null or ${t.credentialFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "gate_access_events_override_check",
      sql`(${t.reasonCode} = 'granted_manual_override') = (${t.overrideReason} is not null)`,
    ),
    check(
      "gate_access_events_override_actor_check",
      sql`${t.reasonCode} <> 'granted_manual_override' or ${t.decidedBy} is not null`,
    ),
    check(
      "gate_access_events_override_reason_check",
      sql`${t.overrideReason} is null or char_length(${t.overrideReason}) between 3 and 500`,
    ),
    // The closed set of reasons, mirrored from
    // lib/services/mock-access/reasons.ts. A reason code that does not
    // exist cannot reach the log.
    check(
      "gate_access_events_reason_check",
      sql`${t.reasonCode} in (
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
      )`,
    ),
    foreignKey({
      name: "gate_access_events_device_tenant_fkey",
      columns: [t.deviceId, t.tenantId],
      foreignColumns: [gateDevices.id, gateDevices.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "gate_access_events_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "gate_access_events_credential_fkey",
      columns: [t.credentialId],
      foreignColumns: [gateCredentials.id],
    }).onDelete("set null"),
    index("gate_access_events_tenant_device_time_idx").on(
      t.tenantId,
      t.deviceId,
      t.occurredAt.desc(),
    ),
    index("gate_access_events_tenant_member_time_idx").on(
      t.tenantId,
      t.memberId,
      t.occurredAt.desc(),
    ),
  ],
);

export type GateDevice = typeof gateDevices.$inferSelect;
export type NewGateDevice = typeof gateDevices.$inferInsert;
export type GateCredential = typeof gateCredentials.$inferSelect;
export type NewGateCredential = typeof gateCredentials.$inferInsert;
export type GateAccessEvent = typeof gateAccessEvents.$inferSelect;
export type NewGateAccessEvent = typeof gateAccessEvents.$inferInsert;
