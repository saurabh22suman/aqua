import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, persons, programs, staff } from "@/db/schema";
import { generateSessions } from "@/lib/jobs/session-generator";
import { getRosterForSession, listTodaySessions, sessionVisibleToCaller } from "@/lib/services/register";
import { todayInZone } from "@/lib/time/tz";
import { asTenantId, asUserId, asStaffId, type TenantId, type UserId, type StaffId } from "@/lib/ids";

// tenants has FORCE row level security, so fixture rows must be created
// through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId: TenantId = asTenantId("");
// ctx.userId in these tests -- the real users.id, since coach scoping
// (lib/services/staff.ts's coachStaffIdSubquery) resolves a caller's
// own staff row via staff.user_id = ctx.userId. batches/sessions.
// coach_id itself stores the resulting staff.id, not this user id.
let coachA: UserId = asUserId("");
let coachB: UserId = asUserId("");
let batchAName = "";
let batchBName = "";
let sessionForBatchA = "";
let sessionForBatchB = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Coach Scope', $3)",
    [tenantId, `coach-scope-${RUN}`, plan.rows[0]?.id ?? null],
  );

  const userA = await admin.query<{ id: string }>(
    "insert into users (id, phone) values ($1, $2) returning id",
    [uuidv7(), `+91coachA${RUN}`.slice(0, 15)],
  );
  const userB = await admin.query<{ id: string }>(
    "insert into users (id, phone) values ($1, $2) returning id",
    [uuidv7(), `+91coachB${RUN}`.slice(0, 15)],
  );
  coachA = asUserId(userA.rows[0].id);
  coachB = asUserId(userB.rows[0].id);

  let locationId = "";
  let programId = "";
  let coachAStaffId: StaffId = asStaffId("");
  let coachBStaffId: StaffId = asStaffId("");
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

    const [personA] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Coach A" })
      .returning({ id: persons.id });
    const [personB] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Coach B" })
      .returning({ id: persons.id });
    const [staffA] = await tx
      .insert(staff)
      .values({ tenantId, personId: personA.id, userId: coachA, staffType: "coach" })
      .returning({ id: staff.id });
    const [staffB] = await tx
      .insert(staff)
      .values({ tenantId, personId: personB.id, userId: coachB, staffType: "coach" })
      .returning({ id: staff.id });
    coachAStaffId = asStaffId(staffA.id);
    coachBStaffId = asStaffId(staffB.id);
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
        coachId: coachAStaffId,
      },
      {
        tenantId,
        programId,
        name: batchBName,
        capacity: 10,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "09:00",
        endTime: "10:00",
        coachId: coachBStaffId,
      },
    ]);
  });

  await withTenant(tenantId, (tx) => generateSessions(tx, tenantId, TZ));

  const sessRows = await admin.query<{ id: string; batch_name: string }>(
    `select s.id, b.name as batch_name
     from sessions s join batches b on b.id = s.batch_id
     where s.tenant_id = $1
     order by s.starts_at`,
    [tenantId],
  );
  sessionForBatchA = sessRows.rows.find((r) => r.batch_name === batchAName)!.id;
  sessionForBatchB = sessRows.rows.find((r) => r.batch_name === batchBName)!.id;
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from staff where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  if (coachA) await admin.query("delete from users where id = $1", [coachA]);
  if (coachB) await admin.query("delete from users where id = $1", [coachB]);
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

// getRosterAction and markAttendanceSessionAction (lib/actions/coach.ts)
// both take a session id directly and, before this fix, only checked
// tenant membership -- scoping the list view (above) while leaving
// direct access open is not a fix: a coach who knows or guesses a
// session id in their own tenant could still open and mark another
// coach's register. Both call sites gate on sessionVisibleToCaller;
// tested once here rather than duplicated per call site.
describe("direct access to a specific session is scoped the same way as the list", () => {
  it("sessionVisibleToCaller is true for the assigned coach", async () => {
    const visible = await sessionVisibleToCaller(
      { tenantId, userId: coachA, roleKey: "coach" },
      sessionForBatchA,
    );
    expect(visible).toBe(true);
  });

  it("sessionVisibleToCaller is false for a DIFFERENT coach, same tenant", async () => {
    const visible = await sessionVisibleToCaller(
      { tenantId, userId: coachA, roleKey: "coach" },
      sessionForBatchB,
    );
    expect(visible).toBe(false);
  });

  it("sessionVisibleToCaller is true for a non-coach staff role regardless of assignment", async () => {
    const visible = await sessionVisibleToCaller(
      { tenantId, userId: coachA, roleKey: "owner" },
      sessionForBatchB,
    );
    expect(visible).toBe(true);
  });

  it("getRosterForSession returns null (not an error, not partial data) for an unassigned coach — this is the 404, not a 403", async () => {
    const roster = await getRosterForSession(
      { tenantId, userId: coachA, roleKey: "coach" },
      sessionForBatchB,
    );
    expect(roster).toBeNull();
  });

  it("getRosterForSession returns the roster for the assigned coach", async () => {
    const roster = await getRosterForSession(
      { tenantId, userId: coachA, roleKey: "coach" },
      sessionForBatchA,
    );
    expect(roster).not.toBeNull();
    expect(roster?.batchName).toBe(batchAName);
  });
});
