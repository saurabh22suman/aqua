import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { pool } from "../db/client";
import { withTenant } from "../db/tenant";
import { roles } from "../db/schema/roles";
import { generateSessions } from "../lib/jobs/session-generator";
import { createMember } from "../lib/services/register";
import { seedRoleTemplates } from "../lib/services/roles";
import {
  defaultPlanId,
  seedPlatformCatalogue,
} from "../db/seed-platform";
import { env } from "@/lib/env";
import { asTenantId, type TenantId } from "../lib/ids";
import { todayInZone } from "../lib/time/tz";

// Demo seed must not run unless DEMO_MODE is on. The flag is the only
// thing distinguishing "the operator wants synthetic demo data on their
// machine" from "an env var was misconfigured and a real club is about
// to receive 16 fake members." Exit before any DB write.
if (!env.DEMO_MODE) {
  console.error(
    "DEMO_MODE is not enabled — refusing to seed demo data.\n" +
      "Set DEMO_MODE=true in your environment to permit this script.",
  );
  process.exit(1);
}

// EDIT-ME: the real academy's details.
const DEMO_TENANT = {
  slug: "demo-academy",
  name: "Demo Academy",
  timezone: "Asia/Kolkata",
  currency: "INR",
  gstin: null as string | null,
  firstLocation: {
    name: "Demo Main",
    address: { line1: "12 Poolside", city: "Bengaluru", state: "KA", postal: "560001" },
  },
};

const DEMO_PROGRAMS = [
  { name: "Swimming Foundations" },
  { name: "Junior Competitive" },
];

const DEMO_BATCHES = [
  { program: "Swimming Foundations", name: "Morning Squad", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "07:00", capacity: 16 },
  { program: "Junior Competitive", name: "Junior TTS", daysOfWeek: [2, 4, 6], startTime: "17:00", capacity: 16 },
];

const DEMO_PEOPLE: Array<{
  name: string;
  phone?: string;
  role: "owner" | "parent" | "coach" | "receptionist" | "accountant" | "worker";
  dateOfBirth?: string;
}> = [
  { name: "Owner A", phone: "+919000000001", role: "owner" },
  { name: "Coach A", phone: "+919000000002", role: "coach" },
  { name: "Parent A", phone: "+919000000003", role: "parent" },
  { name: "Receptionist R", phone: "+919000000004", role: "receptionist" },
  { name: "Coach B", role: "coach" },
];

const DEMO_MEMBERS: Array<{ name: string; code: string; dob: string }> = [
  { name: "Aarav Sharma", code: "MEM-001", dob: "1990-04-12" },
  { name: "Aaradhya Iyer", code: "MEM-002", dob: "1991-09-23" },
  { name: "Arjun Reddy", code: "MEM-003", dob: "1992-06-30" },
  { name: "Anaya Khan", code: "MEM-004", dob: "1993-01-18" },
  { name: "Advik Menon", code: "MEM-005", dob: "1990-11-04" },
  { name: "Diya Pillai", code: "MEM-006", dob: "1991-08-21" },
  { name: "Kabir Das", code: "MEM-007", dob: "1992-03-15" },
  { name: "Kavya Rao", code: "MEM-008", dob: "1990-07-09" },
  { name: "Arjun Nair", code: "MEM-009", dob: "1991-12-01" },
  { name: "Diya Menon", code: "MEM-010", dob: "1993-02-19" },
  { name: "Reyansh Kumar", code: "MEM-011", dob: "1991-08-26" },
  { name: "Aadhya Sharma", code: "MEM-012", dob: "1992-05-14" },
  { name: "Vivaan Iyer", code: "MEM-013", dob: "1990-10-08" },
  { name: "Anika Patel", code: "MEM-014", dob: "1993-04-02" },
  { name: "Arnav Reddy", code: "MEM-015", dob: "1991-12-22" },
  { name: "Misha Khan", code: "MEM-016", dob: "1990-06-11" },
];

const adminPool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

async function ensureTenant(): Promise<TenantId> {
  const existing = await adminPool.query<{ id: string }>(
    "select id from tenants where slug = $1",
    [DEMO_TENANT.slug],
  );
  if (existing.rows.length > 0) return asTenantId(existing.rows[0].id);
  const id = asTenantId(uuidv7());
  const planId = await defaultPlanId(env.MIGRATION_DATABASE_URL);
  await adminPool.query(
    `insert into tenants (id, slug, name, status, plan_id, timezone, currency, gstin)
     values ($1, $2, $3, 'active', $4, $5, $6, $7)`,
    [id, DEMO_TENANT.slug, DEMO_TENANT.name, planId, DEMO_TENANT.timezone, DEMO_TENANT.currency, DEMO_TENANT.gstin],
  );
  return id;
}

async function ensureFirstLocation(tenantId: TenantId): Promise<string> {
  const existing = await adminPool.query<{ id: string }>(
    "select id from locations where tenant_id = $1 and name = $2",
    [tenantId, DEMO_TENANT.firstLocation.name],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const id = uuidv7();
  await adminPool.query(
    `insert into locations (id, tenant_id, name, is_primary, address)
     values ($1, $2, $3, true, $4::jsonb)`,
    [id, tenantId, DEMO_TENANT.firstLocation.name, JSON.stringify(DEMO_TENANT.firstLocation.address)],
  );
  return id;
}

async function ensurePrograms(tenantId: TenantId): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of DEMO_PROGRAMS) {
    const existing = await adminPool.query<{ id: string }>(
      "select id from programs where tenant_id = $1 and name = $2",
      [tenantId, p.name],
    );
    if (existing.rows.length > 0) {
      out.set(p.name, existing.rows[0].id);
      continue;
    }
    const id = uuidv7();
    await adminPool.query(
      `insert into programs (id, tenant_id, name, is_sample, created_by)
       values ($1, $2, $3, true, $4)`,
      [id, tenantId, p.name, null],
    );
    out.set(p.name, id);
  }
  return out;
}

async function ensureBatches(
  tenantId: TenantId,
  programsByName: Map<string, string>,
  locationId: string,
  coachStaffId: string,
): Promise<string[]> {
  const batchIds: string[] = [];
  for (const b of DEMO_BATCHES) {
    const programId = programsByName.get(b.program);
    if (!programId) throw new Error(`batch "${b.name}" references unknown program "${b.program}"`);
    const existing = await adminPool.query<{ id: string }>(
      "select id from batches where tenant_id = $1 and name = $2",
      [tenantId, b.name],
    );
    let id: string;
    if (existing.rows.length > 0) {
      id = existing.rows[0].id;
    } else {
      id = uuidv7();
      const endTime = addHour(b.startTime);
      const dowArr = `{${b.daysOfWeek.join(",")}}`;
      await adminPool.query(
        `insert into batches
           (id, tenant_id, program_id, name, capacity, days_of_week,
            start_time, end_time, is_sample, coach_id, created_by, updated_by)
         values
           ($1, $2, $3, $4, $5, $6::int[], $7, $8, true, $9, null, null)`,
        [id, tenantId, programId, b.name, b.capacity, dowArr, b.startTime, endTime, coachStaffId],
      );
    }
    batchIds.push(id);
  }
  return batchIds;
}

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  const total = (h ?? 0) * 60 + (m ?? 0) + 60;
  const newH = Math.floor((total / 60) % 24);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

async function ensureStaff(
  tenantId: TenantId,
  people: typeof DEMO_PEOPLE,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of people) {
    if (!p.phone) continue;
    const personId = uuidv7();
    await adminPool.query(
      `insert into persons (id, tenant_id, full_name, date_of_birth)
       values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [personId, tenantId, p.name, p.dateOfBirth ?? "1990-01-01"],
    );
    const userResult = await adminPool.query<{ id: string }>(
      `select id from users where phone = $1`,
      [p.phone],
    );
    let userId: string;
    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      userId = uuidv7();
      await adminPool.query(
        `insert into users (id, phone) values ($1, $2)`,
        [userId, p.phone],
      );
    }
    const roleRow = await adminPool.query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = $2",
      [tenantId, p.role],
    );
    if (roleRow.rows.length === 0) continue;
    const roleId = roleRow.rows[0].id;

    const isStaffRole = p.role === "coach" || p.role === "receptionist" || p.role === "accountant" || p.role === "worker";
    if (isStaffRole) {
      const staffRow = await adminPool.query<{ id: string }>(
        "select id from staff where tenant_id = $1 and user_id = $2 and staff_type = $3",
        [tenantId, userId, p.role],
      );
      let staffId: string;
      if (staffRow.rows.length > 0) {
        staffId = staffRow.rows[0].id;
      } else {
        staffId = uuidv7();
        await adminPool.query(
          `insert into staff (id, tenant_id, person_id, user_id, staff_type)
           values ($1, $2, $3, $4, $5)`,
          [staffId, tenantId, personId, userId, p.role],
        );
      }
      out.set(p.phone, staffId);
    }

    await adminPool.query(
      `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
       values (gen_random_uuid(), $1, $2, $3, 'active')
       on conflict (tenant_id, user_id) do nothing`,
      [tenantId, userId, roleId],
    );
  }
  return out;
}

async function ensureMembers(
  tenantId: TenantId,
  locationId: string,
  batchIds: string[],
): Promise<void> {
  for (const m of DEMO_MEMBERS) {
    const result = await createMember({ tenantId, userId: undefined as never }, {
      fullName: m.name,
      dateOfBirth: m.dob,
      memberCode: m.code,
      locationId,
      consents: [
        {
          purpose: "processing",
          policyVersion: "2026.1",
          evidence: { channel: "staff-assisted-in-person" },
        },
      ],
    });
    if (!result.ok) {
      throw new Error(`createMember failed for ${m.code} — ${result.error}`);
    }
    const memberId = result.memberId;
    for (const batchId of batchIds) {
      await adminPool.query(
        `insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on)
         select gen_random_uuid(), $1, $2, $3, current_date
         where not exists (
           select 1 from enrolments
           where tenant_id = $1 and member_id = $2 and batch_id = $3
         )`,
        [tenantId, memberId, batchId],
      );
    }
  }
}

const DEMO_ENQUIRIES: Array<{
  fullName: string;
  phone?: string;
  source: "walk-in" | "phone" | "referral" | "online" | "other";
  stage: "new" | "contacted" | "trial_scheduled" | "trial_completed" | "converted" | "lost";
  notes?: string;
}> = [
  { fullName: "Ishaan Gupta", phone: "+919812345601", source: "walk-in", stage: "new", notes: "Asked about weekend beginner classes for his son." },
  { fullName: "Meera Nair", phone: "+919812345602", source: "online", stage: "contacted", notes: "Called back once; wants a trial." },
  { fullName: "Rohan Mehta", phone: "+919812345603", source: "referral", stage: "trial_scheduled" },
];

async function ensureEnquiries(
  tenantId: TenantId,
): Promise<void> {
  for (const e of DEMO_ENQUIRIES) {
    const existing = await adminPool.query<{ id: string }>(
      "select id from enquiries where tenant_id = $1 and full_name = $2",
      [tenantId, e.fullName],
    );
    if (existing.rows.length > 0) continue;
    await adminPool.query(
      `insert into enquiries (id, tenant_id, full_name, phone, source, stage, notes, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, null, null)`,
      [uuidv7(), tenantId, e.fullName, e.phone ?? null, e.source, e.stage, e.notes ?? null],
    );
  }
  console.log(`enquiries seeded → ${DEMO_ENQUIRIES.length}`);
}

async function main() {
  await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
  console.log("platform catalogue seeded → standard plan + ga features");
  const tenantId = await ensureTenant();
  console.log(`tenant ${DEMO_TENANT.slug} → ${tenantId}`);
  await seedRoleTemplates(tenantId);
  console.log("role templates seeded → owner, admin, receptionist, coach, accountant, worker");

  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(roles)
      .values({
        id: uuidv7(),
        tenantId,
        key: "parent",
        name: "Parent",
        homePath: "/parent",
        homeOrdinal: 3,
        isSystem: false,
      })
      .onConflictDoNothing({ target: [roles.tenantId, roles.key] });
  });

  const locationId = await ensureFirstLocation(tenantId);
  const programsByName = await ensurePrograms(tenantId);
  const staffIdsByPhone = await ensureStaff(tenantId, DEMO_PEOPLE);
  const primaryCoachStaffId = staffIdsByPhone.values().next().value;
  if (!primaryCoachStaffId) throw new Error("DEMO_PEOPLE must include at least one coach with a phone");
  const batchIds = await ensureBatches(tenantId, programsByName, locationId, primaryCoachStaffId);
  console.log(`batches → ${batchIds.length}`);

  await withTenant(tenantId, async (tx) => {
    await generateSessions(tx, tenantId, DEMO_TENANT.timezone);
  });
  console.log(`sessions materialised for next 28 days`);

  await ensureMembers(tenantId, locationId, batchIds);
  console.log(`members seeded → ${DEMO_MEMBERS.length}`);

  const firstBatch = batchIds[0];
  if (firstBatch) {
    const today = todayInZone(DEMO_TENANT.timezone);
    const memberIds = await adminPool.query<{ id: string; member_code: string }>(
      `select id, member_code from members where tenant_id = $1 and deleted_at is null limit 16`,
      [tenantId],
    );
    const todaySession = await adminPool.query<{ id: string }>(
      `select id from sessions where tenant_id = $1 and batch_id = $2 and session_date = $3 limit 1`,
      [tenantId, firstBatch, today],
    );
    if (todaySession.rows.length > 0) {
      for (const m of memberIds.rows) {
        await adminPool.query(
          `insert into attendance (id, tenant_id, session_id, member_id, status, client_id, marked_at)
           values (gen_random_uuid(), $1, $2, $3, 'present', $4, now())
           on conflict (tenant_id, session_id, member_id) do nothing`,
          [tenantId, todaySession.rows[0].id, m.id, `seed-${m.member_code}`],
        );
      }
      const after = await adminPool.query<{ count: string }>(
        `select count(*)::text from attendance where tenant_id = $1 and session_id = $2`,
        [tenantId, todaySession.rows[0].id],
      );
      console.log(`register ${todaySession.rows[0].id.slice(0, 8)}… (${today}): ${after.rows[0]?.count} entries`);
    } else {
      console.log(`no session today (${today}) for first batch — register left empty`);
    }
  }

  await ensureEnquiries(tenantId);

  console.log("\n=== login users ===");
  console.log("+919000000001 owner");
  console.log("+919000000002 coach");
  console.log("+919000000003 parent");
  console.log("+919000000004 receptionist");
  console.log("ops@aqua.local platform operator (from pnpm tsx scripts/seed-platform-user.ts)");

  await pool.end().catch(() => {});
  await adminPool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
