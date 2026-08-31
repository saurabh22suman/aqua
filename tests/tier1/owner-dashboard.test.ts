import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, programs, sessions } from "@/db/schema";
import { createMember, enrolMember, markAttendance } from "@/lib/services/register";
import { getOwnerDashboard } from "@/lib/services/dashboard";
import { todayInZone } from "@/lib/time/tz";

// tenants has FORCE row level security, so fixture rows must be created
// through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId = "";
let locationId = "";
let programId = "";

beforeAll(async () => {
  tenantId = uuidv7();
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Owner Dashboard', $3, $4)",
    [tenantId, `owner-dash-${RUN}`, plan.rows[0]?.id ?? null, TZ],
  );

  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Dashboard Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Dashboard Program" })
      .returning({ id: programs.id });
    programId = p.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

async function makeMember(label: string): Promise<string> {
  const created = await createMember(
    { tenantId, userId: undefined as unknown as string },
    {
      fullName: `Dashboard Member ${label}`,
      dateOfBirth: "1990-01-01",
      locationId,
      memberCode: `DASH-${RUN}-${label}`,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test-fixture" } },
      ],
    },
  );
  if (!created.ok) throw new Error(`fixture setup: createMember failed — ${created.error}`);
  return created.memberId;
}

describe("getOwnerDashboard", () => {
  it("counts only active members", async () => {
    const a = await makeMember("active-1");
    const b = await makeMember("active-2");
    void a;
    void b;

    const data = await getOwnerDashboard({ tenantId });
    expect(data.activeMemberCount).toBeGreaterThanOrEqual(2);
  });

  it("flags a session that has started with zero marks and real enrolments as needing attention", async () => {
    const memberId = await makeMember("unmarked");
    let batchId = "";
    await withTenant(tenantId, async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: `Unmarked Batch ${RUN}`,
          capacity: 10,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: "00:00",
          endTime: "00:01",
        })
        .returning({ id: batches.id });
      batchId = b.id;
    });
    await enrolMember({ tenantId }, { memberId, batchId });

    const today = todayInZone(TZ);
    // Starts well in the past relative to "now" so it reads as begun-but-unmarked.
    const startsAt = new Date(Date.now() - 60 * 60 * 1000);
    const endsAt = new Date(Date.now() - 30 * 60 * 1000);
    await withTenant(tenantId, async (tx) => {
      await tx.insert(sessions).values({
        tenantId,
        batchId,
        sessionDate: today,
        startsAt,
        endsAt,
      });
    });

    const data = await getOwnerDashboard({ tenantId });
    const flagged = data.needsAttention.some((item) => item.detail.includes(`Unmarked Batch ${RUN}`));
    expect(flagged).toBe(true);
  });

  it("does not flag a session once attendance has been marked", async () => {
    const memberId = await makeMember("marked");
    let batchId = "";
    let sessionId = "";
    await withTenant(tenantId, async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: `Marked Batch ${RUN}`,
          capacity: 10,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: "00:00",
          endTime: "00:01",
        })
        .returning({ id: batches.id });
      batchId = b.id;
    });
    await enrolMember({ tenantId }, { memberId, batchId });

    const today = todayInZone(TZ);
    const startsAt = new Date(Date.now() - 60 * 60 * 1000);
    const endsAt = new Date(Date.now() - 30 * 60 * 1000);
    await withTenant(tenantId, async (tx) => {
      const [s] = await tx
        .insert(sessions)
        .values({ tenantId, batchId, sessionDate: today, startsAt, endsAt })
        .returning({ id: sessions.id });
      sessionId = s.id;
    });
    await markAttendance(
      { tenantId },
      { sessionId, memberId, status: "present", clientId: `dash-${RUN}` },
    );

    const data = await getOwnerDashboard({ tenantId });
    const flagged = data.needsAttention.some((item) => item.detail.includes(`Marked Batch ${RUN}`));
    expect(flagged).toBe(false);
  });

  it("does not flag a batch with a today session but zero enrolled members", async () => {
    let batchId = "";
    await withTenant(tenantId, async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: `Empty Batch ${RUN}`,
          capacity: 10,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: "00:00",
          endTime: "00:01",
        })
        .returning({ id: batches.id });
      batchId = b.id;
    });

    const today = todayInZone(TZ);
    const startsAt = new Date(Date.now() - 60 * 60 * 1000);
    const endsAt = new Date(Date.now() - 30 * 60 * 1000);
    await withTenant(tenantId, async (tx) => {
      await tx.insert(sessions).values({ tenantId, batchId, sessionDate: today, startsAt, endsAt });
    });

    const data = await getOwnerDashboard({ tenantId });
    const flagged = data.needsAttention.some((item) => item.detail.includes(`Empty Batch ${RUN}`));
    expect(flagged).toBe(false);
  });

  it("reports today's lanes with enrolled/capacity for each batch with a session today", async () => {
    const memberId = await makeMember("lane");
    let batchId = "";
    await withTenant(tenantId, async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: `Lane Batch ${RUN}`,
          capacity: 4,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: "05:00",
          endTime: "06:00",
        })
        .returning({ id: batches.id });
      batchId = b.id;
    });
    await enrolMember({ tenantId }, { memberId, batchId });

    const today = todayInZone(TZ);
    await withTenant(tenantId, async (tx) => {
      await tx.insert(sessions).values({
        tenantId,
        batchId,
        sessionDate: today,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600_000),
      });
    });

    const data = await getOwnerDashboard({ tenantId });
    const lane = data.todaysLanes.find((l) => l.batchName === `Lane Batch ${RUN}`);
    expect(lane).toBeDefined();
    expect(lane?.capacity).toBe(4);
    expect(lane?.enrolled).toBeGreaterThanOrEqual(1);
  });

  it("returns an honest empty needsAttention array, not fabricated items, when nothing is wrong", async () => {
    const freshTenantId = uuidv7();
    await admin.query(
      "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Empty Dashboard', $3)",
      [freshTenantId, `owner-dash-empty-${RUN}`, TZ],
    );
    const data = await getOwnerDashboard({ tenantId: freshTenantId });
    expect(data.needsAttention).toEqual([]);
    expect(data.activeMemberCount).toBe(0);
    expect(data.todaysLanes).toEqual([]);
    await admin.query("delete from tenants where id = $1", [freshTenantId]);
  });
});
