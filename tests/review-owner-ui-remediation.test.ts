import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";
import { updateMemberSchema } from "@/lib/schemas";

// Owner-UI review remediation (2026-10-13) — data-scope correctness at
// the service layer:
//   P1 inline edits  — updateMember is field-scoped: an unrelated field
//                      survives, an explicit null clears, and the
//                      contract rejects keys outside its allowlist;
//   P1 attendance CSV — getAttendanceReport applies the caller's
//                      location predicate, and an explicit facility can
//                      only narrow within it.

let container: StartedPostgreSqlContainer;
let admin: Pool;
let people: typeof import("@/lib/services/people");
let ownerReports: typeof import("@/lib/services/owner-reports");
let configAdmin: typeof import("@/db/config-admin");

const tenantId = asTenantId(randomUUID());
const ownerUser = asUserId(randomUUID());
const scopedUser = asUserId(randomUUID());
const platformUserId = asUserId(randomUUID());
const LOCATION_SCOPED_KEY = "access.location_scoped_staff" as const;
const locA = randomUUID();
const locB = randomUUID();
const memberA = randomUUID();
const memberB = randomUUID();
const personA = randomUUID();
const personB = randomUUID();
const programId = randomUUID();
const batchA = randomUUID();
const batchB = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();
const memberRefA = randomUUID();
const memberRefB = randomUUID();
const PERIOD = { from: "2026-11-01", to: "2026-12-01" };

const ownerCtx: ActionCtx = {
  tenantId,
  userId: ownerUser,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
  permissions: new Set(["members.read", "members.write", "reports.operational"]),
};

const scopedCtx: ActionCtx = {
  ...ownerCtx,
  userId: scopedUser,
  roleKey: "admin",
  allLocations: false,
  locationIds: [locA],
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "owner-ui-remediation-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(adminUri);
  const { seedRoleTemplates } = await import("@/lib/services/roles");

  people = await import("@/lib/services/people");
  ownerReports = await import("@/lib/services/owner-reports");
  configAdmin = await import("@/db/config-admin");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Owner UI Academy', 'active')",
    [tenantId, `owner-ui-${Date.now().toString(36)}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Worli', true),
       ($2, $3, 'Andheri', false)`,
    [locA, locB, tenantId],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    `insert into users (id, phone) values
       ($1, '+919400000101'), ($2, '+919400000102')`,
    [ownerUser, scopedUser],
  );
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Owner UI Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `owner-ui-${Date.now().toString(36)}@platform.test`],
  );

  // Enable the location-scoped-staff access boundary so the caller's
  // locationIds are actually enforced (the key is OFF by default).
  const enabled = await configAdmin.setPlatformTenantConfigValue({
    tenantId,
    key: LOCATION_SCOPED_KEY,
    value: true,
    actorId: platformUserId,
  });
  if (!enabled.ok) throw new Error("failed to enable location scoping");

  // Members for the inline-edit proof.
  await admin.query(
    `insert into persons (id, tenant_id, full_name, date_of_birth, phone, gender, medical_notes)
     values ($1, $3, 'Original Name', '1990-01-01', '9876500001', 'male', 'Asthma inhaler'),
            ($2, $3, 'Second Person', '1991-02-02', null, null, null)`,
    [personA, personB, tenantId],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status)
     values ($1, $3, $4, $6, 'UI-A', 'active'),
            ($2, $3, $5, $7, 'UI-B', 'active')`,
    [memberA, memberB, tenantId, personA, personB, locA, locB],
  );

  // Attendance report fixtures: one batch per location with one mark.
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Learn to swim')",
    [programId, tenantId],
  );
  await admin.query(
    `insert into batches (id, tenant_id, program_id, location_id, name, capacity, start_time, end_time)
     values ($1, $3, $4, $5, 'Batch Worli', 10, '07:00', '08:00'),
            ($2, $3, $4, $6, 'Batch Andheri', 10, '07:00', '08:00')`,
    [batchA, batchB, tenantId, programId, locA, locB],
  );
  await admin.query(
    `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at)
     values ($1, $3, $4, $6, '2026-11-02', '2026-11-02 01:30Z', '2026-11-02 02:30Z'),
            ($2, $3, $5, $7, '2026-11-02', '2026-11-02 01:30Z', '2026-11-02 02:30Z')`,
    [sessionA, sessionB, tenantId, batchA, batchB, locA, locB],
  );
  await admin.query(
    `insert into attendance (id, tenant_id, session_id, member_id, location_id, status, client_id)
     values ($1, $3, $4, $6, $8, 'present', $10),
            ($2, $3, $5, $7, $9, 'present', $11)`,
    [
      randomUUID(),
      randomUUID(),
      tenantId,
      sessionA,
      sessionB,
      memberA,
      memberB,
      locA,
      locB,
      `ui-a-${memberRefA}`,
      `ui-b-${memberRefB}`,
    ],
  );
});

afterAll(async () => {
  // Services leave app_login connections idle in the application pool.
  // Drain them before stopping Postgres, rather than emitting an unhandled
  // 57P01 error when the container terminates its clients.
  const { pool } = await import("@/db/client");
  await pool.end();
  await admin?.end();
  await container?.stop();
});

describe("updateMember field-scoped patch (P1)", () => {
  it("preserves unrelated person fields when only the name is patched", async () => {
    const result = await people.updateMember(ownerCtx, memberA, {
      fullName: "Renamed Only",
    });
    expect(result.ok).toBe(true);

    const { rows } = await admin.query(
      "select full_name, phone, gender, medical_notes from persons where id = $1",
      [personA],
    );
    expect(rows[0].full_name).toBe("Renamed Only");
    expect(rows[0].phone).toBe("9876500001");
    expect(rows[0].gender).toBe("male");
    expect(rows[0].medical_notes).toBe("Asthma inhaler");
  });

  it("clears an optional field with an explicit null without touching the name", async () => {
    const result = await people.updateMember(ownerCtx, memberA, { phone: null });
    expect(result.ok).toBe(true);

    const { rows } = await admin.query(
      "select full_name, phone from persons where id = $1",
      [personA],
    );
    expect(rows[0].full_name).toBe("Renamed Only");
    expect(rows[0].phone).toBeNull();
  });

  it("does not let a scoped caller patch a member outside their locations", async () => {
    const result = await people.updateMember(scopedCtx, memberB, {
      fullName: "Should Not Apply",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects fields outside the allowlisted contract", () => {
    const parsed = updateMemberSchema.safeParse({
      memberId: memberA,
      status: "left",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("getAttendanceReport location scope (P1)", () => {
  it("returns every accessible batch for an all-locations caller", async () => {
    const rows = await ownerReports.getAttendanceReport(ownerCtx, PERIOD);
    expect(rows.map((r) => r.batchName).sort()).toEqual([
      "Batch Andheri",
      "Batch Worli",
    ]);
  });

  it("narrows to the caller's locations", async () => {
    const rows = await ownerReports.getAttendanceReport(scopedCtx, PERIOD);
    expect(rows.map((r) => r.batchName)).toEqual(["Batch Worli"]);
  });

  it("cannot widen beyond the caller's locations with an explicit facility", async () => {
    const rows = await ownerReports.getAttendanceReport(scopedCtx, PERIOD, {
      locationId: locB,
    });
    expect(rows).toEqual([]);
  });

  it("narrows an all-locations caller to the requested facility", async () => {
    const rows = await ownerReports.getAttendanceReport(ownerCtx, PERIOD, {
      locationId: locB,
    });
    expect(rows.map((r) => r.batchName)).toEqual(["Batch Andheri"]);
  });
});
