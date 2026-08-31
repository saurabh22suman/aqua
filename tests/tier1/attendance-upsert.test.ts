import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, programs } from "@/db/schema";
import { generateSessions } from "@/lib/jobs/session-generator";
import {
  createMember,
  enrolMember,
  markAttendance,
} from "@/lib/services/register";

// tenants has FORCE row level security, so fixture rows must be created
// through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId = "";
let sessionId = "";
let memberA = "";
let memberB = "";

beforeAll(async () => {
  tenantId = uuidv7();
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Attendance Upsert', $3)",
    [tenantId, `attn-${RUN}`, plan.rows[0]?.id ?? null],
  );

  let mainLocationId = "";
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Upsert Hall", isPrimary: true })
      .returning({ id: locations.id });
    mainLocationId = loc.id;
  });

  let programId = "";
  await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Upsert Program" })
      .returning({ id: programs.id });
    programId = p.id;
  });

  let batchId = "";
  await withTenant(tenantId, async (tx) => {
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        capacity: 20,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "07:00",
        endTime: "08:00",
        name: "Upsert Batch",
      })
      .returning({ id: batches.id });
    batchId = b.id;
  });

  const consents = [
    { purpose: "processing" as const, policyVersion: "2026.1", evidence: { channel: "test-fixture" } },
  ];
  const a = await createMember(
    { tenantId, userId: undefined as unknown as string },
    {
      fullName: "Upsert Member A",
      dateOfBirth: "1990-01-01",
      locationId: mainLocationId,
      memberCode: `UP-${RUN}-A`,
      consents,
    },
  );
  const b = await createMember(
    { tenantId, userId: undefined as unknown as string },
    {
      fullName: "Upsert Member B",
      dateOfBirth: "1990-01-01",
      locationId: mainLocationId,
      memberCode: `UP-${RUN}-B`,
      consents,
    },
  );
  if (!a.ok || !b.ok) throw new Error("fixture setup: createMember failed");
  memberA = a.memberId;
  memberB = b.memberId;

  await enrolMember({ tenantId }, { memberId: memberA, batchId });
  await enrolMember({ tenantId }, { memberId: memberB, batchId });

  await withTenant(tenantId, (tx) => generateSessions(tx, tenantId, TZ));

  const sess = await admin.query<{ id: string }>(
    "select id from sessions where tenant_id = $1 order by starts_at limit 1",
    [tenantId],
  );
  expect(sess.rows).toHaveLength(1);
  sessionId = sess.rows[0].id;
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("attendance upsert", () => {
  it("correcting a mark with a new clientId updates the one row instead of throwing", async () => {
    await markAttendance(
      { tenantId },
      {
        sessionId,
        memberId: memberA,
        status: "present",
        clientId: `mark-a-${RUN}`,
      },
    );
    // a correction is a NEW user action with a NEW clientId; it must hit
    // the business key (tenant, session, member), not the clientId key
    await markAttendance(
      { tenantId },
      {
        sessionId,
        memberId: memberA,
        status: "absent",
        clientId: `mark-b-${RUN}`,
      },
    );

    const rows = await admin.query<{ status: string }>(
      "select status from attendance where tenant_id = $1 and session_id = $2 and member_id = $3",
      [tenantId, sessionId, memberA],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe("absent");
  });

  it("replaying the same clientId is idempotent", async () => {
    const clientId = `replay-${RUN}`;
    const mark = () =>
      markAttendance(
        { tenantId },
        { sessionId, memberId: memberB, status: "present", clientId },
      );
    await mark();
    await mark();

    const rows = await admin.query<{ status: string }>(
      "select status from attendance where tenant_id = $1 and session_id = $2 and member_id = $3",
      [tenantId, sessionId, memberB],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe("present");
  });
});
