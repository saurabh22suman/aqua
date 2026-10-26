import { createHmac, hkdfSync } from "node:crypto";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

// Mock-only gate access — the shared test fixture.
//
// The gate services talk to the database through db/client.ts, which
// reads DATABASE_URL when the module is first evaluated. The fixture
// therefore starts its OWN disposable Postgres, points DATABASE_URL at
// it and only then imports the services — that is why every import of
// an Aqua module in here is dynamic.
//
// The fixture seeds the smallest academy that can answer the
// questions the tests ask:
//
//   tenant A ─ location ─ court facility ─┬─ sub-unit "Court 1"
//                                          └─ sub-unit "Court 2"
//   gates       "main"  (premises: PIN + RFID, no facility)
//               "court1" (RFID only, Court 1)
//               "court2" (RFID only, Court 2)
//   members     booked    — a booking on Court 1 right now
//               member    — a membership scoped to the court facility
//               nothing   — no booking, no membership
//   tenant B — a second tenant, so cross-tenant attempts are real

// The gate secret the tests run with. In a deployment this comes from
// the environment (AQUA_GATE_SECRET); the fixture provisions a test-only
// value so the lane's tests are self-contained. The production
// provisioning procedure is in docs/mock-access.md.
export const GATE_TEST_SECRET = "mock-access-test-secret-not-for-production";

// The fingerprint derivation the credential table stores. This is a
// deliberate second implementation of the documented derivation
// (HKDF-SHA256 over the gate secret, salted by tenant and labelled by
// purpose and kind) so the tests pin the DERIVATION rather than
// trusting the helper under test.

export const GATE_NOW = new Date("2026-10-26T10:00:00.000Z");
export const GATE_TODAY = "2026-10-26";

export type GateFixtureIds = {
  tenantId: string;
  otherTenantId: string;
  locationId: string;
  otherLocationId: string;
  poolFacilityId: string;
  courtFacilityId: string;
  subUnitCourt1: string;
  subUnitCourt2: string;
  memberBooked: string;
  memberMembership: string;
  memberNothing: string;
  memberLapsed: string;
  otherMemberId: string;
  staffUserId: string;
};

export type GateFixture = {
  admin: Pool;
  ids: GateFixtureIds;
  stop: () => Promise<void>;
  services: {
    gate: typeof import("@/lib/services/mock-access/gate");
    credentials: typeof import("@/lib/services/mock-access/credentials");
    devices: typeof import("@/lib/services/mock-access/devices");
    override: typeof import("@/lib/services/mock-access/override");
    // The secret module is imported here, not from the test file: it
    // reads lib/env.ts, and lib/env.ts must be evaluated AFTER this
    // fixture points DATABASE_URL at this container. A static import
    // in a test file would freeze the environment too early.
    secret: typeof import("@/lib/services/mock-access/secret");
  };
};

export async function startGateFixture(): Promise<GateFixture> {
  const container: StartedPostgreSqlContainer =
    await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(
    appPassword,
  )}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;
  process.env.BETTER_AUTH_SECRET ??= GATE_TEST_SECRET;
  // The dedicated gate secret. The fixture owns it so a test that
  // removes it can restore it, and so a deployment that forgets it
  // fails loudly rather than silently.
  process.env.AQUA_GATE_SECRET ??= GATE_TEST_SECRET;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  const { reconcileAppPrivileges } = await import("@/db/app-privileges");
  await reconcileAppPrivileges(adminUri);

  const admin = new Pool({ connectionString: adminUri });
  const ids = await seedGateFixture(admin);

  const [gate, credentials, devices, override, secret] = await Promise.all([
    import("@/lib/services/mock-access/gate"),
    import("@/lib/services/mock-access/credentials"),
    import("@/lib/services/mock-access/devices"),
    import("@/lib/services/mock-access/override"),
    import("@/lib/services/mock-access/secret"),
  ]);

  return {
    admin,
    ids,
    services: { gate, credentials, devices, override, secret },
    stop: async () => {
      // The application pool holds connections to this container; close
      // it before the container goes away, or Postgres terminates the
      // sockets and pg reports them as unhandled client errors.
      const { pool } = await import("@/db/client");
      await pool.end().catch(() => {});
      await admin.end();
      await container.stop();
    },
  };
}

export async function seedGateFixture(admin: Pool): Promise<GateFixtureIds> {
  const run = Date.now().toString(36);
  const ids: GateFixtureIds = {
    tenantId: uuidv7(),
    otherTenantId: uuidv7(),
    locationId: uuidv7(),
    otherLocationId: uuidv7(),
    poolFacilityId: uuidv7(),
    courtFacilityId: uuidv7(),
    subUnitCourt1: uuidv7(),
    subUnitCourt2: uuidv7(),
    memberBooked: uuidv7(),
    memberMembership: uuidv7(),
    memberNothing: uuidv7(),
    memberLapsed: uuidv7(),
    otherMemberId: uuidv7(),
    staffUserId: uuidv7(),
  };

  await admin.query(
    `insert into tenants (id, slug, name, status) values
       ($1, $3, 'Gate Academy', 'active'),
       ($2, $4, 'Other Club', 'active')`,
    [ids.tenantId, ids.otherTenantId, `gate-a-${run}`, `gate-b-${run}`],
  );

  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary)
     values ($1, $2, 'Worli', true),
            ($3, $2, 'Andheri', false)`,
    [ids.locationId, ids.tenantId, ids.otherLocationId],
  );

  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity)
     values ($1, $2, $3, 'Badminton Court', 'court', 4),
            ($4, $2, $5, 'Swimming Pool', 'pool', 8)`,
    [
      ids.courtFacilityId,
      ids.tenantId,
      ids.locationId,
      ids.poolFacilityId,
      ids.otherLocationId,
    ],
  );

  await admin.query(
    `insert into facility_sub_units (id, tenant_id, facility_id, name) values
       ($1, $3, $4, 'Court 1'),
       ($2, $3, $4, 'Court 2')`,
    [ids.subUnitCourt1, ids.subUnitCourt2, ids.tenantId, ids.courtFacilityId],
  );

  // people → members
  const memberRows = [
    [ids.memberBooked, "active"],
    [ids.memberMembership, "active"],
    [ids.memberNothing, "active"],
    [ids.memberLapsed, "lapsed"],
  ] as const;
  for (const [memberId, status] of memberRows) {
    const personId = uuidv7();
    await admin.query(
      `insert into persons (id, tenant_id, full_name) values ($1, $2, $3)`,
      [personId, ids.tenantId, `Member ${memberId.slice(0, 8)}`],
    );
    await admin.query(
      `insert into members (id, tenant_id, person_id, location_id, member_code, status)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        memberId,
        ids.tenantId,
        personId,
        ids.locationId,
        `MC-${memberId}`,
        status,
      ],
    );
  }

  // A priced plan and the membership that points at the court facility.
  const planId = uuidv7();
  await admin.query(
    `insert into membership_plans
       (id, tenant_id, location_id, activity_id, name, kind, duration_days, amount_paise)
     values ($1, $2, $3, $4, 'Court Membership', 'duration', 30, 100000)`,
    [planId, ids.tenantId, ids.locationId, ids.courtFacilityId],
  );
  await admin.query(
    `insert into subscriptions
       (id, tenant_id, member_id, plan_id, location_id, activity_id, starts_on, ends_on, status)
     values ($1, $2, $3, $4, $5, $6, '2026-10-01', '2026-10-31', 'active')`,
    [
      uuidv7(),
      ids.tenantId,
      ids.memberMembership,
      planId,
      ids.locationId,
      ids.courtFacilityId,
    ],
  );

  // The booking that runs right now, on Court 1 only.
  await admin.query(
    `insert into bookings
       (id, tenant_id, location_id, facility_id, sub_unit_id, member_id, starts_at, ends_at, status, price_paise)
     values ($1, $2, $3, $4, $5, $6, '2026-10-26T09:00:00.000Z', '2026-10-26T11:00:00.000Z', 'confirmed', 0)`,
    [
      uuidv7(),
      ids.tenantId,
      ids.locationId,
      ids.courtFacilityId,
      ids.subUnitCourt1,
      ids.memberBooked,
    ],
  );

  // The three gates.
  await admin.query(
    `insert into gate_devices
       (id, tenant_id, location_id, device_key, label, facility_id, sub_unit_id, accepts_pin, accepts_rfid, status)
     values
       ($1, $4, $5, 'main',   'Main Gate',  null,   null,   true,  true,  'active'),
       ($2, $4, $5, 'court1', 'Court 1 Gate', $6, $7, false, true,  'active'),
       ($3, $4, $5, 'court2', 'Court 2 Gate', $6, $8, false, true,  'active')`,
    [
      uuidv7(),
      uuidv7(),
      uuidv7(),
      ids.tenantId,
      ids.locationId,
      ids.courtFacilityId,
      ids.subUnitCourt1,
      ids.subUnitCourt2,
    ],
  );

  // The member's credentials. Only digests are stored.
  const credentials: Array<[string, string, string]> = [
    [ids.memberBooked, "rfid", "TAG-BOOKED-001"],
    [ids.memberMembership, "rfid", "TAG-MEMBER-002"],
    [ids.memberNothing, "rfid", "TAG-NOTHING-003"],
    [ids.memberLapsed, "rfid", "TAG-LAPSED-004"],
    [ids.memberBooked, "pin", "482913"],
  ];
  for (const [memberId, kind, secret] of credentials) {
    await admin.query(
      `insert into gate_credentials (id, tenant_id, member_id, kind, secret_hash, label, status)
       values ($1, $2, $3, $4, $5, $6, 'active')`,
      [
        uuidv7(),
        ids.tenantId,
        memberId,
        kind,
        expectedDigest(ids.tenantId, kind, secret),
        `${kind} card`,
      ],
    );
  }

  // A staff user row: the override's audit row references it.
  await admin.query(
    `insert into users (id, phone) values ($1, $2)`,
    [ids.staffUserId, `+9194${String(Date.now()).slice(-8)}7`],
  );

  // The other academy has a gate of its own and a card of its own —
  // with the SAME tag as this academy's card, so the cross-tenant
  // credential check is a real one and the two digests differ.
  const otherLocation = uuidv7();
  const otherMemberId = ids.otherMemberId;
  const otherPersonId = uuidv7();
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary)
     values ($1, $2, 'Other Club Ground', true)`,
    [otherLocation, ids.otherTenantId],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values ($1, $2, 'Other Member')`,
    [otherPersonId, ids.otherTenantId],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status)
     values ($1, $2, $3, $4, $5, 'active')`,
    [
      otherMemberId,
      ids.otherTenantId,
      otherPersonId,
      otherLocation,
      `MC-${otherMemberId}`,
    ],
  );
  await admin.query(
    `insert into gate_devices
       (id, tenant_id, location_id, device_key, label, accepts_pin, accepts_rfid, status)
     values ($1, $2, $3, 'main', 'Other Main Gate', true, true, 'active')`,
    [uuidv7(), ids.otherTenantId, otherLocation],
  );
  await admin.query(
    `insert into gate_credentials (id, tenant_id, member_id, kind, secret_hash, label, status)
     values ($1, $2, $3, 'rfid', $4, 'other academy card', 'active')`,
    [
      uuidv7(),
      ids.otherTenantId,
      otherMemberId,
      expectedDigest(ids.otherTenantId, "rfid", "TAG-BOOKED-001"),
    ],
  );

  return ids;
}

// The documented derivation, reimplemented here so the tests pin it.
export function expectedDigest(
  tenantId: string,
  kind: string,
  secret: string,
): string {
  const serverSecret = process.env.AQUA_GATE_SECRET ?? GATE_TEST_SECRET;
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serverSecret, "utf8"),
      Buffer.from(tenantId, "utf8"),
      `aqua:gate:credential:v1:${kind}`,
      32,
    ),
  );
  return createHmac("sha256", key).update(secret.trim(), "utf8").digest("hex");
}
