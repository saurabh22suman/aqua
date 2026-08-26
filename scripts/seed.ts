import { Pool } from "pg";
import { env } from "@/lib/env";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { pool } from "../db/client";
import { withTenant } from "@/db/tenant";
import { batches, locations, members, programs } from "@/db/schema";
import { sessions as sessionsTable } from "@/db/schema/scheduling";
import { generateSessions } from "@/lib/jobs/session-generator";
import { createMember, countAttendanceForSession, enrolMember, markAttendance } from "@/lib/services/register";
import { seedRoleTemplates } from "@/lib/services/roles";
import { defaultPlanId, seedPlatformCatalogue } from "@/db/seed-platform";

const SLUG = "demo-academy";
const TZ = "Asia/Kolkata";
const MEMBER_COUNT = 16;

const adminPool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

async function ensureTenant(): Promise<string> {
  const existing = await adminPool.query<{ id: string }>(
    "select id from tenants where slug = $1",
    [SLUG],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const id = uuidv7();
  const planId = await defaultPlanId(env.MIGRATION_DATABASE_URL);
  await adminPool.query(
    "insert into tenants (id, slug, name, status, plan_id) values ($1,$2,'Demo Academy','active',$3)",
    [id, SLUG, planId],
  );
  return id;
}

async function main() {
  await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
  console.log("platform catalogue seeded → standard plan + ga features");

  const tenantId = await ensureTenant();
  console.log(`tenant demo-academy → ${tenantId}`);

  await seedRoleTemplates(tenantId);
  console.log("role templates seeded → owner, admin, receptionist, coach, accountant, worker");

  let mainLocationId = "";
  await withTenant(tenantId, async (tx) => {
    const existing = await tx.select({ id: locations.id }).from(locations).where(eq(locations.isPrimary, true));
    if (existing.length > 0) {
      mainLocationId = existing[0].id;
      return;
    }
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Demo Main", isPrimary: true })
      .returning({ id: locations.id });
    mainLocationId = loc.id;
  });
  console.log(`location Demo Main → ${mainLocationId}`);

  let programId = "";
  await withTenant(tenantId, async (tx) => {
    const existing = await tx.select({ id: programs.id }).from(programs).limit(1);
    if (existing.length > 0) {
      programId = existing[0].id;
      return;
    }
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Swimming Foundations" })
      .returning({ id: programs.id });
    programId = p.id;
  });

  const batchSpecs = [
    { name: "Morning Squad", startTime: "07:00", endTime: "08:00", daysOfWeek: [1, 2, 3, 4, 5, 6], capacity: 20 },
    { name: "Evening Juniors", startTime: "17:00", endTime: "18:00", daysOfWeek: [2, 4, 6], capacity: 12 },
  ];
  const batchIds: string[] = [];
  await withTenant(tenantId, async (tx) => {
    for (const spec of batchSpecs) {
      const existing = await tx.select({ id: batches.id }).from(batches).where(eq(batches.name, spec.name));
      if (existing.length > 0) {
        batchIds.push(existing[0].id);
        continue;
      }
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          capacity: spec.capacity,
          daysOfWeek: spec.daysOfWeek,
          startTime: spec.startTime,
          endTime: spec.endTime,
          name: spec.name,
        })
        .returning({ id: batches.id });
      batchIds.push(b.id);
    }
  });
  console.log(`batches → ${batchIds.join(", ")}`);

  const memberIds: string[] = [];
  for (let i = 1; i <= MEMBER_COUNT; i++) {
    const code = `AQUA-${String(i).padStart(3, "0")}`;
    const existingMemberId = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.memberCode, code))
        .limit(1);
      return rows[0]?.id ?? null;
    });
    if (existingMemberId) {
      memberIds.push(existingMemberId);
      continue;
    }
    const created = await createMember(
      { tenantId, userId: undefined as unknown as string },
      {
        fullName: `Synthetic Member ${String(i).padStart(2, "0")}`,
        dateOfBirth: `20${10 + (i % 8)}-0${(i % 9) + 1}-1${i % 9}`,
        gender: i % 2 === 0 ? "female" : "male",
        locationId: mainLocationId,
        memberCode: code,
      },
    );
    memberIds.push(created.memberId);
  }
  console.log(`members seeded → ${memberIds.length}`);

  for (const memberId of memberIds) {
    await enrolMember({ tenantId }, { memberId, batchId: batchIds[0] });
    await enrolMember({ tenantId }, { memberId, batchId: batchIds[1] });
  }

  const createdSessions = await withTenant(tenantId, (tx) =>
    generateSessions(tx, tenantId, TZ),
  );
  console.log(`sessions materialised this run → ${createdSessions} (idempotent across reruns)`);

  const morning = await withTenant(tenantId, async (tx) =>
    tx
      .select({ id: sessionsTable.id, sessionDate: sessionsTable.sessionDate })
      .from(sessionsTable)
      .innerJoin(batches, eq(sessionsTable.batchId, batches.id))
      .where(eq(batches.name, "Morning Squad"))
      .orderBy(sessionsTable.startsAt)
      .limit(1),
  );
  const sessionId = morning[0].id;

  const before = await countAttendanceForSession({ tenantId }, sessionId);

  let marked = 0;
  for (let i = 0; i < memberIds.length; i++) {
    await markAttendance({ tenantId }, {
      sessionId,
      memberId: memberIds[i],
      status: "present",
      clientId: `register-${sessionId}-${memberIds[i]}`,
    });
    marked++;
  }

  const afterFirst = await countAttendanceForSession({ tenantId }, sessionId);

  for (let i = 0; i < memberIds.length; i++) {
    await markAttendance({ tenantId }, {
      sessionId,
      memberId: memberIds[i],
      status: "present",
      clientId: `register-${sessionId}-${memberIds[i]}`,
    });
  }

  const afterReplay = await countAttendanceForSession({ tenantId }, sessionId);

  console.log(`register ${sessionId} (${morning[0].sessionDate})`);
  console.log(`  before            → ${before}`);
  console.log(`  marked            → ${marked} entries`);
  console.log(`  after first pass  → ${afterFirst}`);
  console.log(`  after exact replay→ ${afterReplay}`);

  if (afterFirst !== MEMBER_COUNT || afterReplay !== MEMBER_COUNT) {
    console.error("REPLAY NOT IDEMPOTENT");
    process.exitCode = 1;
  } else {
    console.log("replay idempotent ✓ row count unchanged");

  await ensureLoginUsers(tenantId);
  }

  await pool.end();
  await adminPool.end();
}


main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  await adminPool.end().catch(() => {});
  process.exit(1);
});

const LOGIN_USERS = [
  { phone: "+919000000001", role: "owner" },
  { phone: "+919000000002", role: "coach" },
  { phone: "+919000000003", role: "parent" },
] as const;

async function ensureLoginUsers(tenantId: string) {
  for (const u of LOGIN_USERS) {
    await adminPool.query(
      `insert into users (id, phone)
       select $1, $2
       where not exists (select 1 from users where phone = $2)`,
      [uuidv7(), u.phone],
    );
    await adminPool.query(
      `insert into tenant_memberships (id, tenant_id, user_id, role, status)
       select $1, $2, u.id, $3, 'active'
       from users u where u.phone = $4
       and not exists (
         select 1 from tenant_memberships m
         where m.user_id = u.id and m.tenant_id = $2 and m.role = $3
       )`,
      [uuidv7(), tenantId, u.role, u.phone],
    );
  }
  console.log(`login users ready → ${LOGIN_USERS.map((u) => `${u.phone}=${u.role}`).join(", ")}`);
}

