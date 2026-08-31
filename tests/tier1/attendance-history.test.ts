import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { locations, programs } from "@/db/schema";
import { batches } from "@/db/schema/programs";
import { sessions } from "@/db/schema/scheduling";
import { createMember, enrolMember, markAttendance } from "@/lib/services/register";
import {
  currentMonthPeriod,
  getBatchAttendanceSummary,
  getMemberAttendanceHistory,
} from "@/lib/services/attendance-history";

// Non-Tier-1 safety net. C-27's own done-when: "a member page shows
// accurate monthly attendance" (per-member) plus the Build's other
// target, a per-batch summary.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";
const TODAY = "2026-06-15"; // fixed, so period math is deterministic regardless of when this runs

let tenantId = "";
let locationId = "";
let batchId = "";
let memberId = "";
let sessionInMonthId = "";
let sessionOutOfMonthId = "";

beforeAll(async () => {
  tenantId = uuidv7();
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Attendance History', $3, $4)",
    [tenantId, `attendance-history-${RUN}`, plan.rows[0]?.id ?? null, TZ],
  );

  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "History Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;

    const [program] = await tx
      .insert(programs)
      .values({ tenantId, name: "History Program" })
      .returning({ id: programs.id });

    const [batch] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId: program.id,
        name: "History Batch",
        capacity: 10,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "07:00",
        endTime: "08:00",
      })
      .returning({ id: batches.id });
    batchId = batch.id;

    const [inMonth] = await tx
      .insert(sessions)
      .values({
        tenantId,
        batchId,
        sessionDate: "2026-06-10",
        startsAt: new Date("2026-06-10T01:30:00Z"),
        endsAt: new Date("2026-06-10T02:30:00Z"),
      })
      .returning({ id: sessions.id });
    sessionInMonthId = inMonth.id;

    const [outOfMonth] = await tx
      .insert(sessions)
      .values({
        tenantId,
        batchId,
        sessionDate: "2026-05-28",
        startsAt: new Date("2026-05-28T01:30:00Z"),
        endsAt: new Date("2026-05-28T02:30:00Z"),
      })
      .returning({ id: sessions.id });
    sessionOutOfMonthId = outOfMonth.id;
  });

  const created = await createMember(
    { tenantId, userId: undefined },
    {
      fullName: "History Subject",
      dateOfBirth: "1990-01-01",
      locationId,
      memberCode: `ATH-${RUN}-01`,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
      ],
    },
  );
  if (!created.ok) throw new Error("fixture failed: " + created.error);
  memberId = created.memberId;

  await enrolMember({ tenantId }, { memberId, batchId });
  await markAttendance(
    { tenantId },
    { sessionId: sessionInMonthId, memberId, status: "present", clientId: `ath-${RUN}-in` },
  );
  await markAttendance(
    { tenantId },
    { sessionId: sessionOutOfMonthId, memberId, status: "absent", clientId: `ath-${RUN}-out` },
  );
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("currentMonthPeriod", () => {
  it("computes the [from, to) range for a mid-month date", () => {
    expect(currentMonthPeriod("2026-06-15")).toEqual({ from: "2026-06-01", to: "2026-07-01" });
  });

  it("rolls over correctly in December", () => {
    expect(currentMonthPeriod("2026-12-25")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
});

describe("getMemberAttendanceHistory", () => {
  it("includes only sessions within the period, and reports an accurate percentage", async () => {
    const history = await getMemberAttendanceHistory(
      { tenantId },
      memberId,
      currentMonthPeriod(TODAY),
    );
    expect(history.totalCount).toBe(1); // the May session is excluded
    expect(history.presentCount).toBe(1);
    expect(history.pct).toBe(100);
    expect(history.rows.map((r) => r.sessionId)).toEqual([sessionInMonthId]);
  });

  it("reports pct null, not zero, when nothing was marked in the period", async () => {
    const history = await getMemberAttendanceHistory(
      { tenantId },
      memberId,
      { from: "2020-01-01", to: "2020-02-01" },
    );
    expect(history.totalCount).toBe(0);
    expect(history.pct).toBeNull();
  });
});

describe("getBatchAttendanceSummary", () => {
  it("aggregates across all members' marks within the period", async () => {
    const summary = await getBatchAttendanceSummary({ tenantId }, batchId, currentMonthPeriod(TODAY));
    expect(summary).not.toBeNull();
    expect(summary!.totalMarks).toBe(1);
    expect(summary!.presentMarks).toBe(1);
    expect(summary!.pct).toBe(100);
  });

  it("returns null for a batch outside the tenant", async () => {
    const summary = await getBatchAttendanceSummary({ tenantId }, uuidv7(), currentMonthPeriod(TODAY));
    expect(summary).toBeNull();
  });
});
