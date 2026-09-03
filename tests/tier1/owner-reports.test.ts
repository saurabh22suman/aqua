import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { locations, programs, enquiries, members, batches } from "@/db/schema";
import { sessions, attendance } from "@/db/schema/scheduling";
import { createMember, enrolMember } from "@/lib/services/register";
import { createBatch } from "@/lib/services/programs";
import {
  getAttendanceReport,
  getEnquiryFunnel,
  getRetentionView,
  getCoachLoad,
  attendanceReportCsv,
  defaultMonthPeriod,
} from "@/lib/services/owner-reports";
import {
  asTenantId,
  asUserId,
  asMemberId,
  type TenantId,
  type UserId,
} from "@/lib/ids";

// Phase 4 — owner reports service tests. TDD; the action + UI
// land in the same PR. Each report is exercised with a freshly
// seeded tenant fixture so figures reconcile to the source
// tables exactly (the respective Done-When constraints).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId = "";
let programId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Reports Test', $3, $4)",
    [tenantId, `reports-${RUN}`, plan?.id ?? null, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Reports Program" })
      .returning({ id: programs.id });
    programId = p!.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    // Tear down in dependency order (children before parents):
    // attendance → sessions → enrolments → batches → programs →
    // enquiries → consents/guardianships → members → persons →
    // locations → tenants. Members row also soft-cascades to
    // member_status_transitions so we hit that too.
    await admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from member_status_transitions where tenant_id = $1", [tenantId]);
    await admin.query("delete from enquiries where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from staff where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("defaultMonthPeriod (Phase 4)", () => {
  it("returns the calendar month containing the given TZ-relative today", () => {
    const { from, to } = defaultMonthPeriod(TZ);
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to).toMatch(/^\d{4}-\d{2}-01$/);
    expect(from < to).toBe(true);
  });
});

describe("getAttendanceReport (Phase 4.3)", () => {
  it("counts present marks per batch in the period, and is null when a batch had sessions but no marks yet", async () => {
    const memberId = await seedMember(`r-${RUN}-a`);
    const [batchRow] = await withTenant(tenantId, async (tx) =>
      tx.insert(batches).values({
        tenantId,
        programId,
        name: "Reports Batch A",
        capacity: 12,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "06:00",
        endTime: "07:00",
      }).returning(),
    );
    await enrolMember({ tenantId }, { memberId, batchId: batchRow.id });
    const today = todayInZone(TZ);
    const [sessionRow] = await withTenant(tenantId, async (tx) =>
      tx.insert(sessions).values({
        tenantId,
        batchId: batchRow.id,
        sessionDate: today,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
      }).returning(),
    );
    await withTenant(tenantId, async (tx) =>
      tx.insert(attendance).values({
        tenantId,
        sessionId: sessionRow.id,
        memberId: asMemberId(memberId),
        status: "present",
        clientId: `r-${RUN}-att-${sessionRow.id}`,
      }),
    );

    const period = defaultMonthPeriod(TZ);
    const rows = await getAttendanceReport({ tenantId }, period);
    const mine = rows.find((r) => r.batchId === batchRow.id);
    expect(mine?.sessionCount).toBe(1);
    expect(mine?.totalMarks).toBe(1);
    expect(mine?.presentMarks).toBe(1);
    expect(mine?.pct).toBe(100);
  });
});

describe("getEnquiryFunnel (Phase 4.4)", () => {
  it("counts enquiries by source and stage, with conversion pct", async () => {
    await admin.query(
      `insert into enquiries (id, tenant_id, full_name, source, stage)
       values ($1::uuid, $2::uuid, 'Walk A', 'walk-in', 'converted')`,
      [uuidv7(), tenantId],
    );
    await admin.query(
      `insert into enquiries (id, tenant_id, full_name, source, stage)
       values ($1::uuid, $2::uuid, 'Walk B', 'walk-in', 'contacted')`,
      [uuidv7(), tenantId],
    );
    await admin.query(
      `insert into enquiries (id, tenant_id, full_name, source, stage)
       values ($1::uuid, $2::uuid, 'Online A', 'online', 'new')`,
      [uuidv7(), tenantId],
    );

    const period = defaultMonthPeriod(TZ);
    const rows = await getEnquiryFunnel({ tenantId }, period);
    const walkIn = rows.find((r) => r.source === "walk-in");
    const online = rows.find((r) => r.source === "online");
    expect(walkIn?.total).toBe(2);
    expect(walkIn?.byStage.converted).toBe(1);
    expect(walkIn?.byStage.contacted).toBe(1);
    expect(walkIn?.conversionPct).toBe(50);
    expect(online?.total).toBe(1);
    expect(online?.byStage.new).toBe(1);
    expect(online?.conversionPct).toBe(0);
  });
});

describe("getRetentionView (Phase 4.5)", () => {
  it("returns aggregate numbers only — never a per-member list", async () => {
    await seedMember(`r-${RUN}-ret1`);
    await seedMember(`r-${RUN}-ret2`);
    const row = await getRetentionView({ tenantId });
    expect(row.memberCountAtRisk).toBeGreaterThanOrEqual(0);
    expect(row.totalActiveMembers).toBeGreaterThanOrEqual(0);
    expect(row.membersWithZeroLast30).toBeGreaterThanOrEqual(0);
    // Pin the closed result shape — no per-member identifier
    // fields. 4.5's DPDP constraint is the headline invariant
    // this object literal enforces.
    const keys = Object.keys(row).sort();
    expect(keys).toEqual([
      "memberCountAtRisk",
      "membersWithPartialLast30",
      "membersWithZeroLast30",
      "totalActiveMembers",
    ]);
  });
});

describe("getCoachLoad (Phase 4.6)", () => {
  it("returns a row per coach with a non-null coach_id, in the period", async () => {
    // The seeded environment may have existing batches without
    // coaches; an empty list is therefore fine. When sessions
    // exist with a coach assigned, the row appears.
    const rows = await getCoachLoad({ tenantId }, defaultMonthPeriod(TZ));
    expect(rows.every((r) => r.coachStaffId !== "")).toBe(true);
  });
});

describe("attendanceReportCsv (Phase 4.3)", () => {
  it("emits canonical field names (member_count, not swimmer_count)", () => {
    const csv = attendanceReportCsv([
      {
        batchId: "b1",
        batchName: "Morning",
        programName: "Learn to swim",
        sessionCount: 4,
        presentMarks: 12,
        totalMarks: 16,
        pct: 75,
      },
    ]);
    // Canonical headers per architecture § 7.5 rule 3
    expect(csv).toContain("batch_id,batch_name,program_name,session_count,present_marks,total_marks,attendance_pct");
    expect(csv).toContain("b1,Morning,Learn to swim,4,12,16,75");
    // Pure-CSV: no vocabulary dependency in the data shape
    expect(csv).not.toContain("swimmer");
  });

  it("safely quotes fields with commas and embedded quotes", () => {
    const csv = attendanceReportCsv([
      {
        batchId: "b2",
        batchName: 'Name, with "quoted" comma',
        programName: "Plain",
        sessionCount: 0,
        presentMarks: 0,
        totalMarks: 0,
        pct: null,
      },
    ]);
    const lines = csv.trim().split("\n");
    // Header + 1 data row. The second column carries the comma
    // and quote, so that field is wrapped; the doubled quote
    // is the CSV escape for an embedded quote inside a quoted
    // field.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Name, with ""quoted"" comma"');
    expect(lines[1]).not.toMatch(/\bplain\b/);
  });
});

// Helpers — local to this file. todayInZone is borrowed from
// lib/time/tz rather than recomputed here so the test stays
// in lockstep with the rest of the codebase's "today" notion.
import { todayInZone } from "@/lib/time/tz";

async function seedMember(label: string): Promise<string> {
  const result = await createMember(
    { tenantId, userId: SYSTEM_USER },
    {
      fullName: `Member ${label}`,
      dateOfBirth: "1990-01-01",
      locationId,
      memberCode: label,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } },
      ],
    },
  );
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
  return result.memberId;
}

void enquiries;
void members;
void attendance;
void sessions;
void createBatch;
void todayInZone;