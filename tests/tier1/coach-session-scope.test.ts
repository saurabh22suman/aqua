import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, programs } from "@/db/schema";
import { generateSessions } from "@/lib/jobs/session-generator";
import { listTodaySessions } from "@/lib/services/register";
import { todayInZone } from "@/lib/time/tz";

// tenants has FORCE row level security, so fixture rows must be created
// through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId = "";
const coachA = uuidv7();
const coachB = uuidv7();
let batchAName = "";
let batchBName = "";

beforeAll(async () => {
  tenantId = uuidv7();
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Coach Scope', $3)",
    [tenantId, `coach-scope-${RUN}`, plan.rows[0]?.id ?? null],
  );

  let locationId = "";
  let programId = "";
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Coach Scope Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Coach Scope Program" })
      .returning({ id: programs.id });
    programId = p.id;
  });
  void locationId;

  batchAName = `Coach A's Batch ${RUN}`;
  batchBName = `Coach B's Batch ${RUN}`;
  await withTenant(tenantId, async (tx) => {
    await tx.insert(batches).values([
      {
        tenantId,
        programId,
        name: batchAName,
        capacity: 10,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "07:00",
        endTime: "08:00",
        coachId: coachA,
      },
      {
        tenantId,
        programId,
        name: batchBName,
        capacity: 10,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "09:00",
        endTime: "10:00",
        coachId: coachB,
      },
    ]);
  });

  await withTenant(tenantId, (tx) => generateSessions(tx, tenantId, TZ));
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

// getTodayAction (lib/actions/coach.ts) showed every session in the
// tenant to any staff member, with no coach-assignment scoping at all —
// a coach could see (and, via getRosterAction, mark) another coach's
// register. Tested at the service layer (listTodaySessions), not
// through the "use server" action wrapper, which needs a real
// authenticated session — same separation attendance-upsert.test.ts
// uses for markAttendance.
describe("coach's own sessions are scoped, not tenant-wide", () => {
  it("a coach sees only sessions from batches assigned to them", async () => {
    const today = todayInZone(TZ);
    const rows = await listTodaySessions({ tenantId, userId: coachA, roleKey: "coach" }, today);

    expect(rows.map((r) => r.batchName)).toEqual([batchAName]);
  });

  it("a non-coach staff role (owner, receptionist, ...) still sees every session", async () => {
    const today = todayInZone(TZ);
    const rows = await listTodaySessions(
      { tenantId, userId: coachA, roleKey: "owner" },
      today,
    );

    expect(rows.map((r) => r.batchName).sort()).toEqual(
      [batchAName, batchBName].sort(),
    );
  });
});
