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
import { isMinor } from "../lib/time/tz";

// Demo seed must not run unless DEMO_MODE is on. The flag is the only
// thing distinguishing "the operator wants synthetic demo data on their
// machine" from "an env var was misconfigured and a real club is about
// to receive 40 fake members." Exit before any DB write.
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
  name: "Aqua Worli",
  shortName: "Aqua Worli",
  displayName: "Aqua Worli Aquatic Club",
  timezone: "Asia/Kolkata",
  currency: "INR",
  gstin: null as string | null,
  primaryAccent: "mango" as const,
  firstLocation: {
    name: "Worli Main",
    address: { line1: "12 Poolside", city: "Mumbai", state: "MH", postal: "400018" },
  },
};

// Second tenant — different sport, different preset. The platform
// panel needs more than one row for the comparison to read.
const DEMO_FOOTBALL_TENANT = {
  slug: "kicks-academy",
  name: "Kicks Football Academy",
  shortName: "Kicks",
  displayName: "Kicks Football Academy",
  timezone: "Asia/Kolkata",
  currency: "INR",
  gstin: null as string | null,
  primaryAccent: "marine" as const,
  firstLocation: {
    name: "Bandra Turf",
    address: { line1: "4 Bandra Reclamation", city: "Mumbai", state: "MH", postal: "400050" },
  },
};

// Two coaches with conflicting availability (R.2 surface).
const DEMO_COACH_PRIMARY = {
  phone: "+919000000002",
  fullName: "Coach Aanya Rao",
  role: "coach" as const,
};

const DEMO_COACH_SECONDARY = {
  phone: "+919000000005",
  fullName: "Coach Bhaskar Menon",
  role: "coach" as const,
};

const DEMO_RECEPTIONIST = {
  phone: "+919000000004",
  fullName: "Receptionist Rhea",
  role: "receptionist" as const,
};

const DEMO_ACCOUNTANT = {
  phone: "+919000000006",
  fullName: "Accountant Anil",
  role: "accountant" as const,
};

const DEMO_OWNER = {
  phone: "+919000000001",
  fullName: "Owner Ojaswi",
  role: "owner" as const,
};

// 40 members across realistic archetypes — kids in learn-to-swim with
// parents, teens in competitive squads, adults in morning masters,
// a few paused, a few lapsed. Names are deliberately common Indian
// names so the screens read like a real club.
const DEMO_MEMBERS: Array<{
  fullName: string;
  memberCode: string;
  dateOfBirth: string;
  phone?: string;
  status?: "active" | "trial" | "paused" | "lapsed";
  joinedDaysAgo: number;
}> = [
  // 12 kids in Learn-to-swim — mix of DOB-based minors, with parents
  // as guardians so the parent-page is interesting.
  { fullName: "Aarav Sharma",      memberCode: "AWS-001", dateOfBirth: "2017-04-12", phone: "+919812340001", joinedDaysAgo: 240 },
  { fullName: "Aaradhya Iyer",     memberCode: "AWS-002", dateOfBirth: "2016-09-23", phone: "+919812340002", joinedDaysAgo: 220 },
  { fullName: "Arjun Reddy",       memberCode: "AWS-003", dateOfBirth: "2018-06-30", phone: "+919812340003", joinedDaysAgo: 200 },
  { fullName: "Anaya Khan",        memberCode: "AWS-004", dateOfBirth: "2017-01-18", phone: "+919812340004", joinedDaysAgo: 180 },
  { fullName: "Advik Menon",       memberCode: "AWS-005", dateOfBirth: "2018-11-04", phone: "+919812340005", joinedDaysAgo: 160 },
  { fullName: "Diya Pillai",       memberCode: "AWS-006", dateOfBirth: "2016-08-21", phone: "+919812340006", joinedDaysAgo: 140 },
  { fullName: "Kabir Das",         memberCode: "AWS-007", dateOfBirth: "2017-03-15", phone: "+919812340007", joinedDaysAgo: 120 },
  { fullName: "Kavya Rao",         memberCode: "AWS-008", dateOfBirth: "2019-07-09", phone: "+919812340008", joinedDaysAgo: 100 },
  { fullName: "Reyansh Kumar",     memberCode: "AWS-009", dateOfBirth: "2018-12-26", phone: "+919812340009", joinedDaysAgo: 90 },
  { fullName: "Aadhya Sharma",     memberCode: "AWS-010", dateOfBirth: "2017-05-14", phone: "+919812340010", joinedDaysAgo: 80 },
  { fullName: "Vivaan Iyer",       memberCode: "AWS-011", dateOfBirth: "2019-10-08", phone: "+919812340011", joinedDaysAgo: 60 },
  { fullName: "Anika Patel",       memberCode: "AWS-012", dateOfBirth: "2016-04-02", phone: "+919812340012", joinedDaysAgo: 50 },

  // 8 teens in Junior competitive — older DOBs.
  { fullName: "Arnav Reddy",       memberCode: "JRS-001", dateOfBirth: "2012-12-22", phone: "+919812340013", joinedDaysAgo: 320 },
  { fullName: "Misha Khan",        memberCode: "JRS-002", dateOfBirth: "2011-06-11", phone: "+919812340014", joinedDaysAgo: 300 },
  { fullName: "Vihaan Pillai",     memberCode: "JRS-003", dateOfBirth: "2013-02-09", phone: "+919812340015", joinedDaysAgo: 280 },
  { fullName: "Saanvi Das",        memberCode: "JRS-004", dateOfBirth: "2012-08-30", phone: "+919812340016", joinedDaysAgo: 260 },
  { fullName: "Aarush Iyer",       memberCode: "JRS-005", dateOfBirth: "2013-11-18", phone: "+919812340017", joinedDaysAgo: 240 },
  { fullName: "Anvi Menon",        memberCode: "JRS-006", dateOfBirth: "2012-03-04", phone: "+919812340018", joinedDaysAgo: 220 },
  { fullName: "Ishaan Verma",      memberCode: "JRS-007", dateOfBirth: "2011-09-12", phone: "+919812340019", joinedDaysAgo: 200 },
  { fullName: "Pari Nair",         memberCode: "JRS-008", dateOfBirth: "2012-05-21", phone: "+919812340020", joinedDaysAgo: 180 },

  // 12 adults in Morning Masters — grown-up DOBs.
  { fullName: "Aditya Joshi",      memberCode: "MMS-001", dateOfBirth: "1990-04-12", phone: "+919812340021", joinedDaysAgo: 400 },
  { fullName: "Anjali Bose",       memberCode: "MMS-002", dateOfBirth: "1988-09-23", phone: "+919812340022", joinedDaysAgo: 380 },
  { fullName: "Arun Krishnan",     memberCode: "MMS-003", dateOfBirth: "1985-06-30", phone: "+919812340023", joinedDaysAgo: 360 },
  { fullName: "Deepa Hegde",       memberCode: "MMS-004", dateOfBirth: "1992-01-18", phone: "+919812340024", joinedDaysAgo: 340 },
  { fullName: "Hari Murthy",       memberCode: "MMS-005", dateOfBirth: "1989-11-04", phone: "+919812340025", joinedDaysAgo: 320 },
  { fullName: "Lakshmi Subramanian",memberCode: "MMS-006", dateOfBirth: "1991-08-21", phone: "+919812340026", joinedDaysAgo: 300 },
  { fullName: "Manoj Reddy",       memberCode: "MMS-007", dateOfBirth: "1987-03-15", phone: "+919812340027", joinedDaysAgo: 280 },
  { fullName: "Nandini Kamath",    memberCode: "MMS-008", dateOfBirth: "1993-07-09", phone: "+919812340028", joinedDaysAgo: 260 },
  { fullName: "Prakash Shenoy",    memberCode: "MMS-009", dateOfBirth: "1986-12-26", phone: "+919812340029", joinedDaysAgo: 240 },
  { fullName: "Radha Kulkarni",    memberCode: "MMS-010", dateOfBirth: "1990-05-14", phone: "+919812340030", joinedDaysAgo: 220 },
  { fullName: "Sandeep Nayak",     memberCode: "MMS-011", dateOfBirth: "1984-10-08", phone: "+919812340031", joinedDaysAgo: 200 },
  { fullName: "Vidya Bhat",        memberCode: "MMS-012", dateOfBirth: "1992-04-02", phone: "+919812340032", joinedDaysAgo: 180 },

  // 5 paused — life events, injuries, travel. Two with consent already.
  { fullName: "Aakash Kulkarni",   memberCode: "AWS-013", dateOfBirth: "2017-04-12", phone: "+919812340033", joinedDaysAgo: 300, status: "paused" },
  { fullName: "Ishita Bhat",       memberCode: "JRS-009", dateOfBirth: "2012-04-12", phone: "+919812340034", joinedDaysAgo: 280, status: "paused" },
  { fullName: "Karthik Shenoy",    memberCode: "AWS-014", dateOfBirth: "2017-04-12", phone: "+919812340035", joinedDaysAgo: 260, status: "paused" },
  { fullName: "Lata Kamath",       memberCode: "MMS-013", dateOfBirth: "1988-04-12", phone: "+919812340036", joinedDaysAgo: 240, status: "paused" },
  { fullName: "Nikhil Joshi",      memberCode: "JRS-010", dateOfBirth: "2013-04-12", phone: "+919812340037", joinedDaysAgo: 220, status: "paused" },

  // 3 lapsed — used to be members, dropped off.
  { fullName: "Pranav Kulkarni",   memberCode: "AWS-015", dateOfBirth: "2017-04-12", phone: "+919812340038", joinedDaysAgo: 600, status: "lapsed" },
  { fullName: "Rhea Nayak",        memberCode: "MMS-014", dateOfBirth: "1992-04-12", phone: "+919812340039", joinedDaysAgo: 540, status: "lapsed" },
  { fullName: "Suhas Iyer",       memberCode: "JRS-011", dateOfBirth: "2013-04-12", phone: "+919812340040", joinedDaysAgo: 480, status: "lapsed" },
];

// Football tenant — 8 members, 4 in U-14 Squad (minors) and 4 in Open
// Practice (adults). Phone range +919812340101..108 stays clear of the
// Aqua Worli members' +919812340001..040. Codes KFB-* do not collide
// with AWS/JRS/MMS prefixes, so the member list reads as a distinct
// tenant at a glance.
const DEMO_FOOTBALL_MEMBERS: Array<{
  fullName: string;
  memberCode: string;
  dateOfBirth: string;
  phone?: string;
  batch: "U-14 Squad" | "Open Practice";
  joinedDaysAgo: number;
}> = [
  { fullName: "Atharv Joshi",    memberCode: "KFB-001", dateOfBirth: "2014-02-12", phone: "+919812340101", batch: "U-14 Squad",    joinedDaysAgo: 220 },
  { fullName: "Bhavna Reddy",     memberCode: "KFB-002", dateOfBirth: "2013-08-21", phone: "+919812340102", batch: "U-14 Squad",    joinedDaysAgo: 200 },
  { fullName: "Chirag Patel",     memberCode: "KFB-003", dateOfBirth: "2012-11-04", phone: "+919812340103", batch: "U-14 Squad",    joinedDaysAgo: 180 },
  { fullName: "Devika Singh",     memberCode: "KFB-004", dateOfBirth: "2015-05-19", phone: "+919812340104", batch: "U-14 Squad",    joinedDaysAgo: 160 },
  { fullName: "Eshaan Nair",      memberCode: "KFB-005", dateOfBirth: "1996-04-12", phone: "+919812340105", batch: "Open Practice", joinedDaysAgo: 400 },
  { fullName: "Falguni Kulkarni", memberCode: "KFB-006", dateOfBirth: "1994-09-23", phone: "+919812340106", batch: "Open Practice", joinedDaysAgo: 380 },
  { fullName: "Gaurav Desai",     memberCode: "KFB-007", dateOfBirth: "1992-06-30", phone: "+919812340107", batch: "Open Practice", joinedDaysAgo: 360 },
  { fullName: "Hiral Shah",       memberCode: "KFB-008", dateOfBirth: "1998-01-18", phone: "+919812340108", batch: "Open Practice", joinedDaysAgo: 340 },
];

const adminPool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

async function ensureTenant(
  t: typeof DEMO_TENANT | typeof DEMO_FOOTBALL_TENANT,
  presetKey: string,
): Promise<TenantId> {
  const existing = await adminPool.query<{ id: string }>(
    "select id from tenants where slug = $1",
    [t.slug],
  );
  if (existing.rows.length > 0) return asTenantId(existing.rows[0].id);

  const id = asTenantId(uuidv7());
  const planId = await defaultPlanId(env.MIGRATION_DATABASE_URL);
  await adminPool.query(
    `insert into tenants (id, slug, name, status, plan_id, preset_key, preset_version,
                         timezone, currency, gstin, branding)
     values ($1, $2, $3, 'active', $4, $5, 1, $6, $7, $8, $9::jsonb)`,
    [
      id,
      t.slug,
      t.name,
      planId,
      presetKey,
      t.timezone,
      t.currency,
      t.gstin,
      JSON.stringify({
        displayName: t.displayName,
        shortName: t.shortName,
        accent: t.primaryAccent,
      }),
    ],
  );
  return id;
}

async function ensureLocation(
  tenantId: TenantId,
  name: string,
  address: { line1: string; city: string; state: string; postal: string },
): Promise<string> {
  const existing = await adminPool.query<{ id: string }>(
    "select id from locations where tenant_id = $1 and name = $2",
    [tenantId, name],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const id = uuidv7();
  await adminPool.query(
    `insert into locations (id, tenant_id, name, is_primary, address)
     values ($1, $2, $3, true, $4::jsonb)`,
    [id, tenantId, name, JSON.stringify(address)],
  );
  return id;
}

async function ensureStaff(
  tenantId: TenantId,
  people: Array<{ phone: string; fullName: string; role: "owner" | "parent" | "coach" | "receptionist" | "accountant" | "worker" }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of people) {
    const personId = uuidv7();
    await adminPool.query(
      `insert into persons (id, tenant_id, full_name)
       values ($1, $2, $3)
       on conflict (id) do nothing`,
      [personId, tenantId, p.fullName],
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

async function ensurePrograms(
  tenantId: TenantId,
  programs: Array<{ name: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of programs) {
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
       values ($1, $2, $3, false, null)`,
      [id, tenantId, p.name],
    );
    out.set(p.name, id);
  }
  return out;
}

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  const total = (h ?? 0) * 60 + (m ?? 0) + 60;
  const newH = Math.floor((total / 60) % 24);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

type BatchSpec = {
  program: string;
  name: string;
  daysOfWeek: number[];
  startTime: string;
  capacity: number;
  fillCount?: number;
  startsInDays?: number;
};

// Five batches at different times and fill levels:
//   - Morning Squad (Learn-to-swim)  full — 16 enrolled against 16
//   - Junior TTS (Junior competitive)  healthy — 8 enrolled against 16
//   - Morning Masters                    nearly empty — 2 enrolled against 16
//   - Trial Squad (Learn-to-swim)        starting next week — 1 enrolled
//   - Holiday Recovery (Junior)          empty — for R.3 holiday visibility
const DEMO_BATCHES: BatchSpec[] = [
  {
    program: "Learn-to-swim",
    name: "Morning Squad",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "07:00",
    capacity: 12,
    fillCount: 12,
  },
  {
    program: "Junior competitive",
    name: "Junior TTS",
    daysOfWeek: [2, 4, 6],
    startTime: "17:00",
    capacity: 16,
    fillCount: 8,
  },
  {
    program: "Adult masters",
    name: "Morning Masters",
    daysOfWeek: [1, 3, 5],
    startTime: "06:00",
    capacity: 16,
    fillCount: 2,
  },
  {
    program: "Learn-to-swim",
    name: "Trial Squad",
    daysOfWeek: [1, 3, 5],
    startTime: "16:00",
    capacity: 12,
    fillCount: 1,
    startsInDays: 7,
  },
  {
    program: "Junior competitive",
    name: "Holiday Recovery",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "18:00",
    capacity: 12,
    fillCount: 0,
  },
];

async function ensureBatches(
  tenantId: TenantId,
  programsByName: Map<string, string>,
  locationId: string,
  primaryCoachStaffId: string | undefined,
  secondaryCoachStaffId: string | undefined,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
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
      // Primary coach on the morning batches, secondary coach on
      // the rest. The R.2 demo conflict comes from the Late Squad
      // block in main(), which assigns the same primary coach to
      // another batch overlapping Mon-Fri 18:00-19:00.
      const coachId =
        b.name === "Morning Squad" || b.name === "Morning Masters"
          ? primaryCoachStaffId
          : secondaryCoachStaffId;
      const endTime = addHour(b.startTime);
      const dowArr = `{${b.daysOfWeek.join(",")}}`;
      await adminPool.query(
        `insert into batches
           (id, tenant_id, program_id, name, capacity, days_of_week,
            start_time, end_time, is_sample, coach_id, created_by, updated_by)
         values
           ($1, $2, $3, $4, $5, $6::int[], $7, $8, false, $9, null, null)`,
        [id, tenantId, programId, b.name, b.capacity, dowArr, b.startTime, endTime, coachId],
      );
    }
    out.set(b.name, id);
  }
  return out;
}

type MemberSeedResult = {
  memberId: string;
  fullName: string;
  status: string;
  dob: string;
};

async function ensureMembers(
  tenantId: TenantId,
  locationId: string,
  batchIdsByName: Map<string, string>,
): Promise<MemberSeedResult[]> {
  const out: MemberSeedResult[] = [];
  for (const m of DEMO_MEMBERS) {
    const existing = await adminPool.query<{ id: string; status: string }>(
      `select id, status from members where tenant_id = $1 and member_code = $2`,
      [tenantId, m.memberCode],
    );
    if (existing.rows.length > 0) {
      out.push({
        memberId: existing.rows[0].id,
        fullName: m.fullName,
        status: existing.rows[0].status,
        dob: m.dateOfBirth,
      });
      continue;
    }

    const result = await createMember({ tenantId, userId: undefined as never }, {
      fullName: m.fullName,
      dateOfBirth: m.dateOfBirth,
      memberCode: m.memberCode,
      locationId,
      initialStatus: m.status ?? "active",
      phone: m.phone,
      consents: [
        {
          purpose: "processing",
          policyVersion: "2026.1",
          evidence: { channel: "staff-assisted-in-person" },
        },
      ],
      // Minors (DOB-derived) need a guardian row. The audit-side
      // consent gate (C-05) refuses to register a minor without one;
      // the seed must mirror the production shape exactly so the
      // surfaces exercise real data, not synthetic-with-guardians-
      // bypassed.
      ...(isMinorDateOfBirth(m.dateOfBirth, DEMO_TENANT.timezone)
        ? {
            guardian: {
              fullName: `${m.fullName.split(" ")[0]}'s parent`,
              phone: m.phone,
              relationship: "parent",
            },
          }
        : {}),
    });
    if (!result.ok) {
      throw new Error(`createMember failed for ${m.memberCode} — ${result.error}`);
    }
    const memberId = result.memberId;
    out.push({
      memberId,
      fullName: m.fullName,
      status: m.status ?? "active",
      dob: m.dateOfBirth,
    });

    // Distribute members across batches by code prefix:
    //   AWS-* → Morning Squad (full) + Trial Squad (started trial)
    //   JRS-* → Junior TTS
    //   MMS-* → Morning Masters (near-empty — most stay unenrolled
    //          so the "near-empty" effect is visible)
    const code = m.memberCode;
    const targets: string[] = [];
    if (code.startsWith("AWS-")) {
      targets.push("Morning Squad");
    } else if (code.startsWith("JRS-")) {
      targets.push("Junior TTS");
    } else if (code.startsWith("MMS-")) {
      // Only 2 of the 12 masters enrolled so the batch reads as
      // "nearly empty" — the dashboard's "needs attention" lane
      // strip highlights this.
      if (code === "MMS-001" || code === "MMS-002") {
        targets.push("Morning Masters");
      }
    }
    if (m.status === "paused" || m.status === "lapsed") {
      // They don't get new enrolments. The status transition row
      // is recorded by createMember (initial status path).
      continue;
    }
    for (const t of targets) {
      const batchId = batchIdsByName.get(t);
      if (!batchId) continue;
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
  return out;
}

const DEMO_ENQUIRIES: Array<{
  fullName: string;
  phone: string;
  source: "walk-in" | "phone" | "referral" | "online" | "other";
  stage: "new" | "contacted" | "trial_scheduled" | "trial_completed" | "converted" | "lost";
  notes?: string;
  daysAgo: number;
  followUpDaysFromNow?: number;
  followUpDone?: boolean;
}> = [
  // Every stage gets at least one row.
  {
    fullName: "Ishaan Gupta",
    phone: "+919812345601",
    source: "walk-in",
    stage: "new",
    notes: "Asked about weekend beginner classes for his son.",
    daysAgo: 1,
  },
  {
    fullName: "Meera Nair",
    phone: "+919812345602",
    source: "online",
    stage: "contacted",
    notes: "Called back once; wants a trial this week.",
    daysAgo: 3,
    followUpDaysFromNow: -2, // overdue follow-up
    followUpDone: false,
  },
  {
    fullName: "Rohan Mehta",
    phone: "+919812345603",
    source: "referral",
    stage: "trial_scheduled",
    notes: "Trial booked for Thursday 4pm.",
    daysAgo: 5,
    followUpDaysFromNow: 2,
    followUpDone: false,
  },
  {
    fullName: "Anaya Joshi",
    phone: "+919812345604",
    source: "online",
    stage: "trial_completed",
    notes: "Trial done; conversion pending.",
    daysAgo: 8,
    followUpDaysFromNow: -1, // overdue
    followUpDone: false,
  },
  {
    fullName: "Riya Subramaniam",
    phone: "+919812345605",
    source: "walk-in",
    stage: "converted",
    notes: "Converted to MMS — see member MMS-013.",
    daysAgo: 14,
    followUpDone: true,
  },
  {
    fullName: "Kabir Verma",
    phone: "+919812345606",
    source: "phone",
    stage: "lost",
    notes: "Lost to a competitor closer to home.",
    daysAgo: 30,
    followUpDone: true,
  },
  {
    fullName: "Tara Kothari",
    phone: "+919812345607",
    source: "online",
    stage: "new",
    notes: "Website form, looking for adult masters.",
    daysAgo: 2,
  },
  {
    fullName: "Vivaan Kothari",
    phone: "+919812345608",
    source: "referral",
    stage: "contacted",
    notes: "Friend of MMS-007; callback pending.",
    daysAgo: 4,
    followUpDaysFromNow: 1,
    followUpDone: false,
  },
];

// Football tenant — 2 enquiries, distinct names + phones from the
// Aqua Worli list so the second tenant's enquiry list reads as a
// separate pool. Stages: one new, one contacted with overdue follow-up
// (mirrors the Aqua Worli pattern so the operator's "needs attention"
// lane surface still has something to demo on a second tenant).
const DEMO_FOOTBALL_ENQUIRIES: Array<{
  fullName: string;
  phone: string;
  source: "walk-in" | "phone" | "referral" | "online" | "other";
  stage: "new" | "contacted";
  notes?: string;
  daysAgo: number;
  followUpDaysFromNow?: number;
}> = [
  {
    fullName: "Ishita Iyer",
    phone: "+919812345701",
    source: "walk-in",
    stage: "new",
    notes: "Asked about U-14 trial slot.",
    daysAgo: 1,
  },
  {
    fullName: "Jai Deshpande",
    phone: "+919812345702",
    source: "referral",
    stage: "contacted",
    notes: "Came via an existing Open Practice parent.",
    daysAgo: 3,
    followUpDaysFromNow: -2,
  },
];

async function ensureEnquiries(tenantId: TenantId): Promise<void> {
  const today = todayInZone(DEMO_TENANT.timezone);
  for (const e of DEMO_ENQUIRIES) {
    const existing = await adminPool.query<{ id: string }>(
      "select id from enquiries where tenant_id = $1 and full_name = $2",
      [tenantId, e.fullName],
    );
    if (existing.rows.length > 0) continue;
    const createdAt = new Date(`${today}T00:00:00Z`);
    createdAt.setUTCDate(createdAt.getUTCDate() - e.daysAgo);
    const id = uuidv7();
    await adminPool.query(
      `insert into enquiries (id, tenant_id, full_name, phone, source, stage, notes,
                              created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8, null, null)`,
      [
        id,
        tenantId,
        e.fullName,
        e.phone,
        e.source,
        e.stage,
        e.notes ?? null,
        createdAt,
      ],
    );
    if (e.followUpDaysFromNow !== undefined) {
      const due = new Date(`${today}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + e.followUpDaysFromNow);
      const followUpId = uuidv7();
      if (e.followUpDone) {
        await adminPool.query(
          `insert into enquiry_follow_ups
             (id, tenant_id, enquiry_id, due_at, done_at, note, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, null, null)`,
          [followUpId, tenantId, id, due, due, "Done in demo seed."],
        );
      } else {
        await adminPool.query(
          `insert into enquiry_follow_ups
             (id, tenant_id, enquiry_id, due_at, note, created_by, updated_by)
           values ($1, $2, $3, $4, $5, null, null)`,
          [followUpId, tenantId, id, due, e.notes ?? "Follow up."],
        );
      }
    }
  }
  console.log(`enquiries seeded → ${DEMO_ENQUIRIES.length}`);
}

// R.3 — one holiday in the next 30 days so the session generator
// skips a day and "Holiday Recovery" reads as scheduled.
async function ensureHolidays(tenantId: TenantId): Promise<void> {
  const today = todayInZone(DEMO_TENANT.timezone);
  const holidayDate = new Date(`${today}T00:00:00Z`);
  holidayDate.setUTCDate(holidayDate.getUTCDate() + 14);
  const dateStr = holidayDate.toISOString().slice(0, 10);
  const existing = await adminPool.query<{ id: string }>(
    "select id from tenant_holidays where tenant_id = $1 and holiday_date = $2",
    [tenantId, dateStr],
  );
  if (existing.rows.length > 0) return;
  await adminPool.query(
    `insert into tenant_holidays (id, tenant_id, name, holiday_date, recurring_yearly)
     values ($1, $2, $3, $4, false)`,
    [uuidv7(), tenantId, "Founder's Day", dateStr],
  );
  console.log(`holiday seeded → ${dateStr} Founder's Day`);
}

// R.5 — one waitlist entry on the near-empty Morning Masters batch.
async function ensureWaitlist(
  tenantId: TenantId,
  batchId: string,
  memberId: string,
): Promise<void> {
  const existing = await adminPool.query<{ id: string }>(
    `select id from waitlist_entries where tenant_id = $1 and batch_id = $2 and member_id = $3 and status = 'waiting'`,
    [tenantId, batchId, memberId],
  );
  if (existing.rows.length > 0) return;
  await adminPool.query(
    `insert into waitlist_entries (id, tenant_id, member_id, batch_id, status, position)
     values ($1, $2, $3, $4, 'waiting', 1)`,
    [uuidv7(), tenantId, memberId, batchId],
  );
  console.log(`waitlist seeded → 1 entry on Morning Masters`);
}

// R.7 — one makeup credit for a child who was excused from a recent
// session. The credit row references a past session_id; we attach
// it to whichever session we generated 5 days ago.
async function ensureMakeupCredit(
  tenantId: TenantId,
  memberId: string,
  sourceSessionId: string,
): Promise<void> {
  const existing = await adminPool.query<{ id: string }>(
    `select id from makeup_credits where tenant_id = $1 and member_id = $2 and source_session_id = $3`,
    [tenantId, memberId, sourceSessionId],
  );
  if (existing.rows.length > 0) return;
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + 60);
  await adminPool.query(
    `insert into makeup_credits (id, tenant_id, member_id, source_session_id, status, expires_at)
     values ($1, $2, $3, $4, 'granted', $5)`,
    [uuidv7(), tenantId, memberId, sourceSessionId, expires],
  );
  console.log(`makeup credit seeded → 1 granted`);
}

// R.1 — substitution on a past session: pick a session from a
// batch that originally had Coach Aanya (primary) and swap to
// Coach Bhaskar (secondary). The session-generator and our past-
// session materialiser both inherit the batch's coach, so past
// sessions on Morning Squad already have the primary coach. The
// substitution here records "actually Coach Bhaskar took this
// one" so the V-31 payout reads the right person.
async function ensureSubstitution(
  tenantId: TenantId,
  primaryCoachStaffId: string | undefined,
  secondaryCoachStaffId: string | undefined,
): Promise<void> {
    if (!primaryCoachStaffId || !secondaryCoachStaffId) return;
  // Find a past Morning Squad session. The substitution is
  // specific enough to be a single session — a single swap, not a
  // blanket replacement of every coach.
  const pastSession = await adminPool.query<{ id: string }>(
    `select s.id from sessions s
     join batches b on b.id = s.batch_id
     where s.tenant_id = $1 and s.session_date < current_date
       and s.coach_id = $2 and b.name = 'Morning Squad'
       and s.session_date = (
         select max(s2.session_date) from sessions s2
         where s2.tenant_id = $1 and s2.coach_id = $2
           and s2.session_date < current_date
       )
     limit 1`,
    [tenantId, primaryCoachStaffId],
  );
  if (pastSession.rows.length === 0) {
    console.log(`substitution: no past Morning Squad session with primary coach found`);
    return;
  }
  const sessionId = pastSession.rows[0].id;
  const result = await adminPool.query(
    `update sessions set coach_id = $1, updated_at = now()
     where id = $2 and coach_id = $3`,
    [secondaryCoachStaffId, sessionId, primaryCoachStaffId],
  );
  if (result.rowCount && result.rowCount > 0) {
    console.log(`substitution seeded → session ${sessionId.slice(0, 8)}… coach swapped`);
  }
}

async function markAttendance(
  tenantId: TenantId,
  memberId: string,
  sessionDate: string,
  status: "present" | "absent" | "late",
  batchId?: string,
): Promise<void> {
  const session = await adminPool.query<{ id: string }>(
    batchId
      ? `select id from sessions where tenant_id = $1 and batch_id = $2 and session_date = $3 limit 1`
      : `select id from sessions where tenant_id = $1 and session_date = $2 limit 1`,
    batchId ? [tenantId, batchId, sessionDate] : [tenantId, sessionDate],
  );
  if (session.rows.length === 0) return;
  const sessionId = session.rows[0].id;
  // client_id must be unique per tenant. UUID v7s generated in
  // the same millisecond share the first ~10 chars (timestamp +
  // variant) — member_ids in a single seed run all share that
  // prefix. Use enough of the member_id that the tenant+session+
  // member tuple is genuinely unique.
  const clientId = `seed-${sessionDate}-${sessionId.slice(0, 8)}-${memberId}`;
  await adminPool.query(
    `insert into attendance (id, tenant_id, session_id, member_id, status, client_id, marked_at)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, now())
     on conflict (tenant_id, session_id, member_id) do nothing`,
    [tenantId, sessionId, memberId, status, clientId],
  );
}

// Past sessions for the demo — the session-generator only
// materialises future sessions; the demo needs both windows
// populated so attendance history has something to render.
async function ensurePastSessions(
  tenantId: TenantId,
  batchIdsByName: Map<string, string>,
): Promise<void> {
  const today = todayInZone(DEMO_TENANT.timezone);
  const now = new Date(`${today}T00:00:00Z`);
  let created = 0;
  for (let d = 21; d >= 1; d--) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - d);
    const dateStr = day.toISOString().slice(0, 10);
    const dow = day.getUTCDay();
    for (const [batchName, batchId] of batchIdsByName) {
      const spec = DEMO_BATCHES.find((b) => b.name === batchName);
      if (!spec || !spec.daysOfWeek.includes(dow)) continue;
      if (spec.startsInDays) continue;
      const existing = await adminPool.query<{ id: string }>(
        "select id from sessions where tenant_id = $1 and batch_id = $2 and session_date = $3",
        [tenantId, batchId, dateStr],
      );
      if (existing.rows.length > 0) continue;
      const endTime = addHour(spec.startTime);
      const coachIdRow = await adminPool.query<{ coach_id: string }>(
        "select coach_id from batches where id = $1",
        [batchId],
      );
      const coachId = coachIdRow.rows[0]?.coach_id ?? null;
      await adminPool.query(
        `insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at, status, coach_id)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 'held', $6)`,
        [
          tenantId,
          batchId,
          dateStr,
          `${dateStr}T${spec.startTime}:00Z`,
          `${dateStr}T${endTime}:00Z`,
          coachId,
        ],
      );
      created++;
    }
  }
  if (created > 0) console.log(`past sessions materialised → ${created}`);
}

async function ensureAttendanceHistory(
  tenantId: TenantId,
  members: MemberSeedResult[],
  batchIdsByName: Map<string, string>,
): Promise<void> {
  const today = todayInZone(DEMO_TENANT.timezone);

  await ensurePastSessions(tenantId, batchIdsByName);

  const batchMemberMap = new Map<string, string[]>();
  for (const b of Array.from(batchIdsByName.keys())) {
    const batchId = batchIdsByName.get(b);
    if (!batchId) continue;
    const enrolled = await adminPool.query<{ member_id: string }>(
      `select member_id from enrolments where tenant_id = $1 and batch_id = $2`,
      [tenantId, batchId],
    );
    batchMemberMap.set(b, enrolled.rows.map((r) => r.member_id));
  }

  const now = new Date(`${today}T00:00:00Z`);
  for (let d = 21; d >= 1; d--) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - d);
    const dateStr = day.toISOString().slice(0, 10);
    const dow = day.getUTCDay();
    for (const [batchName, batchId] of batchIdsByName) {
      const spec = DEMO_BATCHES.find((b) => b.name === batchName);
      if (!spec || !spec.daysOfWeek.includes(dow)) continue;
      if (spec.startsInDays) continue;

      const memberIds = batchMemberMap.get(batchName) ?? [];
      for (const memberId of memberIds) {
        const isLowAttendance =
          members.find((m) => m.fullName === "Aaradhya Iyer")?.memberId === memberId ||
          members.find((m) => m.fullName === "Ishaan Verma")?.memberId === memberId;
        const r = hash01(`${memberId}-${dateStr}`);
        const status: "present" | "absent" | "late" = isLowAttendance
          ? r < 0.55
            ? "absent"
            : r < 0.85
              ? "present"
              : "late"
          : r < 0.08
            ? "late"
            : r < 0.20
              ? "absent"
              : "present";
        await markAttendance(tenantId, memberId, dateStr, status, batchId);
      }
    }
  }
  console.log(`attendance seeded → 21 days of mixed present/absent/late`);
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function isMinorDateOfBirth(dob: string, timezone: string): boolean {
  // The seed runs the same isMinor() the service uses — anything
  // else risks the script silently diverging from production rules
  // for what counts as a minor.
  return isMinor(dob, timezone);
}

async function ensureKicksFootballTenant(): Promise<void> {
  const tenantId = await ensureTenant(DEMO_FOOTBALL_TENANT, "multi-sport");
  await seedRoleTemplates(tenantId);
  const locationId = await ensureLocation(
    tenantId,
    DEMO_FOOTBALL_TENANT.firstLocation.name,
    DEMO_FOOTBALL_TENANT.firstLocation.address,
  );
  // The locationId is not used directly — ensureLocation returns it
  // and the batches reference it via the location table only
  // through the (member-location) join, not as a column on batches.
  // For consistency with the main tenant's seed, we resolve it here
  // anyway so the structure reads the same.
  const programsByName = await ensurePrograms(tenantId, [
    { name: "Junior football" },
    { name: "Senior football" },
  ]);
  const staffIdsByPhone = await ensureStaff(tenantId, [
    DEMO_OWNER,
    DEMO_RECEPTIONIST,
    {
      phone: "+919000000007",
      fullName: "Coach Faraz Khan",
      role: "coach" as const,
    },
  ]);
  // The map is keyed by phone and contains staff-role entries only;
  // owner/parent entries are skipped at insertion. Pull by the
  // coach's known phone rather than "the first non-empty value",
  // which would silently pick up the receptionist's id.
  const coachStaffId = staffIdsByPhone.get("+919000000007");
  if (!coachStaffId) throw new Error("football tenant needs at least one coach");
  // Two batches for football tenant.
  const today = todayInZone(DEMO_FOOTBALL_TENANT.timezone);
  const dayStr = today;

  const fbBatches: BatchSpec[] = [
    {
      program: "Junior football",
      name: "U-14 Squad",
      daysOfWeek: [1, 3, 5],
      startTime: "16:00",
      capacity: 22,
      fillCount: 18,
    },
    {
      program: "Senior football",
      name: "Open Practice",
      daysOfWeek: [2, 4, 6],
      startTime: "18:00",
      capacity: 22,
      fillCount: 14,
    },
  ];

  const fbBatchIds = new Map<string, string>();
  for (const b of fbBatches) {
    const programId = programsByName.get(b.program);
    if (!programId) continue;
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
           ($1, $2, $3, $4, $5, $6::int[], $7, $8, false, $9, null, null)`,
        [id, tenantId, programId, b.name, b.capacity, dowArr, b.startTime, endTime, coachStaffId],
      );
    }
    fbBatchIds.set(b.name, id);
  }

  await adminPool.query(
    `insert into tenants (id, slug, name, status, plan_id, preset_key, preset_version,
                         timezone, currency, gstin, branding)
     values (gen_random_uuid(), 'orphan-tenant', 'Orphan Demo', 'churned',
             (select id from plans where is_default = true), null, null,
             'Asia/Kolkata', 'INR', null, '{}'::jsonb)
     on conflict (slug) do nothing`,
  );

  await withTenant(tenantId, async (tx) => {
    await generateSessions(tx, tenantId, DEMO_FOOTBALL_TENANT.timezone);
  });
  // Members + enrolments + enquiries + past attendance — enough that
  // the second tenant reads as a live club (not an empty shell) on
  // the platform tenant list. See DEMO_FOOTBALL_MEMBERS / _ENQUIRIES
  // for the data shapes.
  const fbMembers = await ensureFootballMembers(tenantId, locationId, fbBatchIds);
  await ensureFootballEnquiries(tenantId);
  await ensureFootballPastAttendance(tenantId, fbBatchIds, fbMembers);
  console.log(
    `football tenant ${DEMO_FOOTBALL_TENANT.slug} → ${fbBatches.length} batches`,
  );
  void dayStr;
}

// Football tenant — members. Pattern mirrors ensureMembers for Aqua
// Worli: createMember (which writes the person, member, guardian for
// minors, and processing consent in one transaction), then enrol
// into the assigned batch. Guardian rows are required for the four
// minors (DPDP) — same shape as Aqua Worli minors, with the parent's
// phone defaulting to the member's phone so the data is self-contained.
async function ensureFootballMembers(
  tenantId: TenantId,
  locationId: string,
  fbBatchIds: Map<string, string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const m of DEMO_FOOTBALL_MEMBERS) {
    const existing = await adminPool.query<{ id: string }>(
      `select id from members where tenant_id = $1 and member_code = $2`,
      [tenantId, m.memberCode],
    );
    let memberId: string;
    if (existing.rows.length > 0) {
      memberId = existing.rows[0].id;
    } else {
      const result = await createMember({ tenantId, userId: undefined as never }, {
        fullName: m.fullName,
        dateOfBirth: m.dateOfBirth,
        memberCode: m.memberCode,
        locationId,
        phone: m.phone,
        consents: [
          {
            purpose: "processing",
            policyVersion: "2026.1",
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
        ...(isMinorDateOfBirth(m.dateOfBirth, DEMO_FOOTBALL_TENANT.timezone)
          ? {
              guardian: {
                fullName: `${m.fullName.split(" ")[0]}'s parent`,
                phone: m.phone,
                relationship: "parent",
              },
            }
          : {}),
      });
      if (!result.ok) {
        throw new Error(`football createMember failed for ${m.memberCode} — ${result.error}`);
      }
      memberId = result.memberId;
    }
    out.set(m.memberCode, memberId);

    const batchId = fbBatchIds.get(m.batch);
    if (!batchId) continue;
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
  console.log(`football members seeded → ${out.size}`);
  return out;
}

// Football tenant — enquiries. Mirrors ensureEnquiries for Aqua Worli.
// One new, one contacted with overdue follow-up so the operator's
// "needs attention" lane lights up on the second tenant too.
async function ensureFootballEnquiries(tenantId: TenantId): Promise<void> {
  const today = todayInZone(DEMO_FOOTBALL_TENANT.timezone);
  for (const e of DEMO_FOOTBALL_ENQUIRIES) {
    const existing = await adminPool.query<{ id: string }>(
      "select id from enquiries where tenant_id = $1 and full_name = $2",
      [tenantId, e.fullName],
    );
    if (existing.rows.length > 0) continue;
    const createdAt = new Date(`${today}T00:00:00Z`);
    createdAt.setUTCDate(createdAt.getUTCDate() - e.daysAgo);
    const id = uuidv7();
    await adminPool.query(
      `insert into enquiries (id, tenant_id, full_name, phone, source, stage, notes,
                              created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8, null, null)`,
      [
        id,
        tenantId,
        e.fullName,
        e.phone,
        e.source,
        e.stage,
        e.notes ?? null,
        createdAt,
      ],
    );
    if (e.followUpDaysFromNow !== undefined) {
      const due = new Date(`${today}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + e.followUpDaysFromNow);
      await adminPool.query(
        `insert into enquiry_follow_ups
           (id, tenant_id, enquiry_id, due_at, note, created_by, updated_by)
         values ($1, $2, $3, $4, $5, null, null)`,
        [uuidv7(), tenantId, id, due, e.notes ?? "Follow up."],
      );
    }
  }
  console.log(`football enquiries seeded → ${DEMO_FOOTBALL_ENQUIRIES.length}`);
}

// Football tenant — past sessions + attendance. Smaller window than
// Aqua Worli (7 days vs 21) because the second tenant is not the
// primary walkthrough target — enough for an operator to see the
// register pattern, not enough to drown the demo. Mark attendance
// for one batch (U-14 Squad) so the register screen has data.
async function ensureFootballPastAttendance(
  tenantId: TenantId,
  fbBatchIds: Map<string, string>,
  fbMembers: Map<string, string>,
): Promise<void> {
  const today = todayInZone(DEMO_FOOTBALL_TENANT.timezone);
  const now = new Date(`${today}T00:00:00Z`);
  const u14BatchId = fbBatchIds.get("U-14 Squad");
  if (!u14BatchId) return;
  const spec = { startTime: "16:00" };
  const enrolledRows = await adminPool.query<{ id: string; member_id: string }>(
    `select e.id, e.member_id from enrolments e where e.tenant_id = $1 and e.batch_id = $2`,
    [tenantId, u14BatchId],
  );
  if (enrolledRows.rows.length === 0) return;
  for (let d = 7; d >= 1; d--) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - d);
    const dateStr = day.toISOString().slice(0, 10);
    const dow = day.getUTCDay();
    // U-14 Squad runs Mon/Wed/Fri (1, 3, 5).
    if (![1, 3, 5].includes(dow)) continue;

    // Materialise the past session if missing.
    const existing = await adminPool.query<{ id: string }>(
      "select id from sessions where tenant_id = $1 and batch_id = $2 and session_date = $3",
      [tenantId, u14BatchId, dateStr],
    );
    let sessionId: string;
    if (existing.rows.length > 0) {
      sessionId = existing.rows[0].id;
    } else {
      const endTime = addHour(spec.startTime);
      const coachIdRow = await adminPool.query<{ coach_id: string }>(
        "select coach_id from batches where id = $1",
        [u14BatchId],
      );
      const coachId = coachIdRow.rows[0]?.coach_id ?? null;
      sessionId = uuidv7();
      await adminPool.query(
        `insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at, status, coach_id)
         values ($1, $2, $3, $4, $5, $6, 'held', $7)`,
        [
          sessionId,
          tenantId,
          u14BatchId,
          dateStr,
          `${dateStr}T${spec.startTime}:00Z`,
          `${dateStr}T${endTime}:00Z`,
          coachId,
        ],
      );
    }

    // Mark attendance — 75% present, 25% absent on this batch, by
    // hashing member_id so the same member is consistently present
    // or absent across the window (deterministic rather than random
    // so re-running the seed does not flip a row each time).
    for (const er of enrolledRows.rows) {
      const status = hash01(er.member_id) < 0.75 ? "present" : "absent";
      const clientId = `seed-football-${dateStr}-${sessionId.slice(0, 8)}-${er.member_id}`;
      await adminPool.query(
        `insert into attendance (id, tenant_id, session_id, member_id, status, client_id, marked_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, now())
         on conflict (tenant_id, session_id, member_id) do nothing`,
        [tenantId, sessionId, er.member_id, status, clientId],
      );
    }
  }
  void fbMembers;
  console.log(`football past attendance seeded → u-14 squad, 7 days`);
}

async function main() {
  await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
  console.log("platform catalogue seeded → standard plan + ga features");

  // Main tenant — swimming.
  const tenantId = await ensureTenant(DEMO_TENANT, "swimming");
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

  const locationId = await ensureLocation(
    tenantId,
    DEMO_TENANT.firstLocation.name,
    DEMO_TENANT.firstLocation.address,
  );
  const programsByName = await ensurePrograms(tenantId, [
    { name: "Learn-to-swim" },
    { name: "Junior competitive" },
    { name: "Adult masters" },
  ]);

  const staffIdsByPhone = await ensureStaff(tenantId, [
    DEMO_OWNER,
    DEMO_COACH_PRIMARY,
    DEMO_COACH_SECONDARY,
    DEMO_RECEPTIONIST,
    DEMO_ACCOUNTANT,
  ]);
  const primaryCoachStaffId = staffIdsByPhone.get(DEMO_COACH_PRIMARY.phone);
  const secondaryCoachStaffId = staffIdsByPhone.get(DEMO_COACH_SECONDARY.phone);

  // For R.2 to surface visibly: assign Coach Aanya (primary) to
  // BOTH Morning Squad AND a Tuesday-evening batch that overlaps.
  // The simplest way: add a sixth batch (Junior TTS) where Coach Aanya
  // also coaches — but the existing Junior TTS uses the secondary.
  // Solution: have Coach Aanya cover Morning Squad AND a new "Late
  // Squad" (Tuesday 17:30-18:30) so editing either shows a conflict.
  // We add the Late Squad below after the main five are created.
  const batchIdsByName = await ensureBatches(
    tenantId,
    programsByName,
    locationId,
    primaryCoachStaffId,
    secondaryCoachStaffId,
  );

  // Late Squad — R.2 demo helper. Tuesday 17:30-18:30 with primary coach,
  // overlapping Morning Squad's 07:00-08:00 only on day-of-week, but
  // Coach Aanya appears twice in her schedule which the conflict UI
  // flags when editing either batch's coach assignment.
  // The R.2 conflict detector operates on day-of-week + time, so we
  // need same-day overlap. Make this batch Monday-Friday 18:00-19:00
  // and overlap with Holiday Recovery's 18:00-19:00 (Mon-Fri) by
  // giving both the same coach.
  {
    const existing = await adminPool.query<{ id: string }>(
      "select id from batches where tenant_id = $1 and name = $2",
      [tenantId, "Late Squad"],
    );
    if (existing.rows.length === 0) {
      const id = uuidv7();
      const programId = programsByName.get("Adult masters");
      if (programId && primaryCoachStaffId) {
        await adminPool.query(
          `insert into batches
             (id, tenant_id, program_id, name, capacity, days_of_week,
              start_time, end_time, is_sample, coach_id, created_by, updated_by)
           values
             ($1, $2, $3, $4, $5, $6::int[], $7, $8, false, $9, null, null)`,
          [id, tenantId, programId, "Late Squad", 12, "{1,2,3,4,5}", "18:00", "19:00", primaryCoachStaffId],
        );
        batchIdsByName.set("Late Squad", id);
        // Re-assign Holiday Recovery to primary coach too so the
        // R.2 conflict detector catches the overlap on Mon-Fri 18:00-19:00.
        const holidayId = batchIdsByName.get("Holiday Recovery");
        if (holidayId) {
          await adminPool.query(
            `update batches set coach_id = $1, updated_at = now() where id = $2 and tenant_id = $3`,
            [primaryCoachStaffId, holidayId, tenantId],
          );
        }
      }
    }
  }

  await withTenant(tenantId, async (tx) => {
    await generateSessions(tx, tenantId, DEMO_TENANT.timezone);
  });
  console.log(`sessions materialised for next 28 days`);

  const members = await ensureMembers(tenantId, locationId, batchIdsByName);
  console.log(`members seeded → ${members.length}`);

  await ensureAttendanceHistory(tenantId, members, batchIdsByName);

  // R.1 — substitution on a past session.
  if (primaryCoachStaffId && secondaryCoachStaffId) {
    await ensureSubstitution(tenantId, primaryCoachStaffId, secondaryCoachStaffId);
  }

  // R.5 — waitlist on Morning Masters.
  const masterBatchId = batchIdsByName.get("Morning Masters");
  const aMember = members.find((m) => m.fullName === "Advik Menon");
  if (masterBatchId && aMember) {
    await ensureWaitlist(tenantId, masterBatchId, aMember.memberId);
  }

  // R.7 — makeup credit for an excused absence. Find an actual
  // session that happened five days ago on Morning Squad (where
  // Aaradhya is enrolled), then create the credit against it.
  const today = todayInZone(DEMO_TENANT.timezone);
  const fiveDaysAgo = new Date(`${today}T00:00:00Z`);
  fiveDaysAgo.setUTCDate(fiveDaysAgo.getUTCDate() - 5);
  const fiveDaysAgoStr = fiveDaysAgo.toISOString().slice(0, 10);
  const morningSquadId = batchIdsByName.get("Morning Squad");
  const childWithCredit = members.find((m) => m.fullName === "Aaradhya Iyer");
  if (morningSquadId && childWithCredit) {
    const pastSession = await adminPool.query<{ id: string }>(
      `select id from sessions where tenant_id = $1 and batch_id = $2 and session_date = $3 limit 1`,
      [tenantId, morningSquadId, fiveDaysAgoStr],
    );
    if (pastSession.rows.length > 0) {
      await ensureMakeupCredit(tenantId, childWithCredit.memberId, pastSession.rows[0].id);
    }
  }

  // R.3 — holiday.
  await ensureHolidays(tenantId);

  await ensureEnquiries(tenantId);

  console.log("\n=== login users ===");
  console.log("+919000000001 owner");
  console.log("+919000000002 coach (primary)");
  console.log("+919000000005 coach (secondary)");
  console.log("+919000000004 receptionist");
  console.log("+919000000006 accountant");
  console.log("ops@aqua.local platform operator (from pnpm tsx scripts/seed-platform-user.ts)");

  // Second tenant — football. Different preset, different accent, so the
  // platform tenant list shows two rows with visibly different states.
  await ensureKicksFootballTenant();

  await pool.end().catch(() => {});
  await adminPool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
