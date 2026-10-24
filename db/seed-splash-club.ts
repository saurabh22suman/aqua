import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "./tenant";
import { createMember } from "@/lib/services/register";
import { seedRoleTemplates } from "@/lib/services/roles";
import { seedDefaultLeaveTypes } from "@/lib/services/leave";
import { setCredentialForPhone } from "@/lib/services/credentials";
import { applyPreset } from "./preset-engine";
import { defaultPlanId, seedPlatformCatalogue } from "./seed-platform";
import { requireMigrationUrl } from "@/lib/env";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";
import { isMinor } from "@/lib/time/tz";

// Splash Sports Club — the synthetic club a deployment can seed.
//
// A deployment starts with an empty database: no tenant, no members,
// no batch, no subscription. That is correct for a real club (the
// operator creates its own), but it makes a pilot impossible to demo —
// there is nothing to sign in to and nothing to show.
//
// This seeder writes ONE synthetic club, deliberately and on
// request, so a pilot has something to look at:
//
//   tenant     Splash Sports Club, on the SWIMMING preset (three swim
//              programs, a four-lane pool facility, monthly + quarterly
//              plan shapes)
//   location   the pool (the preset's primary location, renamed)
//   staff      owner, coach, receptionist — with a phone + PIN so they
//              can actually sign in
//   students   eight swimmers (two of them minors, with guardians)
//   batch      "Evening Squad", Mon/Wed/Fri 18:00
//   plan + subscription
//              a priced monthly membership plan and a subscription on
//              it, so dues and renewal invoicing have something to
//              read
//
// Everything here is SYNTHETIC. It exists to be looked at, not to be
// real: the names, phones, dates and amounts are invented.
//
// Gated twice, on purpose:
//
//   * db/deploy.ts only calls this when SEED_SPLASH_CLUB is true —
//     the flag has to be set in the deployment's environment.
//   * the seeder refuses to run without SEED_SPLASH_CLUB_PIN — a
//     deployment that seeds a club must also say what PIN its staff
//     sign in with. There is no default PIN here on purpose: a fixed
//     credential on a publicly reachable host is a credential anyone
//     can use.
//
// The demo-mode switch is NOT the gate here. That switch means "this
// process is a local demo", and the app REFUSES TO SERVE in production
// with it set (lib/env.ts), so it cannot be the switch for a
// deployment. lib/env.ts explains the difference in full.
//
// Idempotent: every step checks for what it is about to create, so
// re-running the deploy (the flag stays true) refreshes nothing and
// duplicates nothing.

// The club. Synthetic by construction — see the header.
const SPLASH = {
  slug: "splash-sports-club",
  name: "Splash Sports Club",
  shortName: "Splash",
  displayName: "Splash Sports Club",
  timezone: "Asia/Kolkata",
  currency: "INR",
  locationName: "Splash Pool",
  address: { line1: "4 Marine Drive", city: "Mumbai", state: "MH", postal: "400020" },
} as const;

// Synthetic staff. The +9190000002xx block is used ONLY by this
// seeder so it can never collide with the demo clubs' numbers
// (+9190000000xx) or with a real member added later.
const STAFF = [
  { phone: "+919000000201", fullName: "Rhea Kapoor", role: "owner" as const },
  { phone: "+919000000202", fullName: "Imran Sheikh", role: "coach" as const },
  { phone: "+919000000203", fullName: "Nisha Pillai", role: "receptionist" as const },
];

// Synthetic swimmers. Two are minors: a minor without a guardian row
// is refused by the registration service (C-05), so the seed mirrors
// the production shape exactly rather than bypassing the guard.
const STUDENTS = [
  { code: "SPL-001", fullName: "Aarav Mehta", phone: "+919000000210", dob: "2015-04-11" },
  { code: "SPL-002", fullName: "Diya Menon", phone: "+919000000211", dob: "2013-09-02" },
  { code: "SPL-003", fullName: "Kabir Shah", phone: "+919000000212", dob: "1989-01-23" },
  { code: "SPL-004", fullName: "Sara Thomas", phone: "+919000000213", dob: "1996-06-30" },
  { code: "SPL-005", fullName: "Vihaan Rao", phone: "+919000000214", dob: "2012-02-18" },
  { code: "SPL-006", fullName: "Ananya Iyer", phone: "+919000000215", dob: "1991-11-07" },
  { code: "SPL-007", fullName: "Rohan Gupta", phone: "+919000000216", dob: "1985-03-15" },
  { code: "SPL-008", fullName: "Meera Joshi", phone: "+919000000217", dob: "1998-08-22" },
];

// The batch they swim in.
const BATCH = {
  name: "Evening Squad",
  daysOfWeek: [1, 3, 5] as const,
  startTime: "18:00",
  endTime: "19:00",
  capacity: 16,
};

// The priced monthly plan and the subscription on it. The preset's
// plan shapes carry NO price by design (architecture §7.4 — a seeded
// price a club forgets to change becomes a billing dispute), so the
// amount is set here, explicitly, for the synthetic club only.
const MONTHLY_PLAN = {
  name: "Monthly Swimming",
  kind: "duration" as const,
  durationDays: 30,
  amountPaise: 300000n, // ₹3,000
};

// The privileged connection. This module writes across the tenant
// boundary on purpose (it CREATES a tenant), so it uses the same
// privileged pool scripts/seed-demo.ts uses — not the app pool.
// Created lazily so importing this module never needs the URL, and
// closed at the end of the seed.
let adminPool: Pool | null = null;

function db(): Pool {
  if (!adminPool) {
    adminPool = new Pool({
      connectionString: requireMigrationUrl("db/seed-splash-club.ts"),
    });
  }
  return adminPool;
}

// What the seeder needs from the deployment's configuration. The
// caller (db/deploy.ts) reads the validated env and passes it here, so
// there is ONE reader of the variables and the seeder stays a pure
// function of its inputs.
export type SplashSeedOptions = {
  /** SEED_SPLASH_CLUB — seed the club at all. */
  enabled: boolean;
  /** SEED_SPLASH_CLUB_PIN — the PIN the seeded staff sign in with. */
  pin?: string;
};

export type SplashSeedResult = {
  tenantId: string;
  locationId: string;
  batchId: string;
  memberIds: string[];
  staffCount: number;
};

/**
 * Seed the Splash Sports Club. Safe to call repeatedly.
 *
 * Throws when the caller has not opted in: SEED_SPLASH_CLUB must be
 * true and SEED_SPLASH_CLUB_PIN must be set. The pin is required
 * because a seeded staff row without a credential is a club nobody
 * can sign in to, and a DEFAULT credential on a public host is a
 * credential everybody can use.
 */
export async function seedSplashSportsClub(
  options: SplashSeedOptions,
): Promise<SplashSeedResult> {
  try {
    return await seed(options);
  } finally {
    // The privileged pool is closed here, not on the success path
    // only: a seed that throws halfway (a missing role template, a
    // bad PIN) must not leave a live connection behind. A connection
    // that outlives the database it points at is an unhandled error
    // in whatever process closed that database — the test's
    // throwaway container, or a redeploy's database going away.
    await adminPool?.end();
    adminPool = null;
  }
}

async function seed(options: SplashSeedOptions): Promise<SplashSeedResult> {
  if (!options.enabled) {
    throw new Error(
      "SEED_SPLASH_CLUB is not enabled — refusing to seed the Splash Sports Club.",
    );
  }
  const pin = (options.pin ?? "").trim();
  if (!/^\d{6,12}$/.test(pin)) {
    throw new Error(
      "SEED_SPLASH_CLUB_PIN must be 6-12 digits — refusing to seed a club " +
        "whose staff cannot sign in (and refusing to fall back to a fixed PIN).",
    );
  }
  const migrationUrl = requireMigrationUrl("db/seed-splash-club.ts");

  // The catalogue (presets, activity types, permissions, the default
  // plan) is what the tenant below is built from. It is platform-wide
  // and idempotent.
  await seedPlatformCatalogue(migrationUrl);

  const actor = await ensureBootstrapActor();
  const tenantId = await ensureTenant(actor);
  const locationId = await ensureLocation(tenantId);
  await ensureStaff(tenantId);
  await setStaffCredentials(pin);
  const batchId = await ensureBatch(tenantId, locationId);
  const memberIds = await ensureStudents(tenantId, locationId, batchId);
  await ensureMonthlyPlan(tenantId, locationId);
  await ensureSubscription(tenantId, locationId, memberIds[0]!);

  console.log(
    `splash sports club seeded → tenant ${tenantId}, ${STAFF.length} staff, ` +
      `${memberIds.length} students, batch ${BATCH.name}`,
  );
  return {
    tenantId,
    locationId,
    batchId,
    memberIds,
    staffCount: STAFF.length,
  };
}

// applyPreset's audit columns need a real platform_users row as the
// actor. The operator row may not exist yet on a fresh database (the
// env operator door creates its row on FIRST sign-in, not before),
// so stand up a synthetic bootstrap actor. The email is unique and
// the credentials are placeholders that can never authenticate.
async function ensureBootstrapActor(): Promise<UserId> {
  const existing = await db().query<{ id: string }>(
    "select id from platform_users where email = $1",
    ["splash-seed-bootstrap@aqua.local"],
  );
  if (existing.rows[0]) return asUserId(existing.rows[0].id);
  const id = uuidv7();
  await db().query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, $3, 'splash-seed-not-a-real-password', 'splash-seed-not-a-real-salt', 'admin', 'active')`,
    [id, "splash-seed-bootstrap@aqua.local", "Splash Seed Bootstrap Actor"],
  );
  return asUserId(id);
}

async function ensureTenant(actor: UserId): Promise<TenantId> {
  const existing = await db().query<{ id: string }>(
    "select id from tenants where slug = $1",
    [SPLASH.slug],
  );
  if (existing.rows.length > 0) {
    // The tenant exists: make sure the standard roles and leave types
    // are there (a partial earlier run may have stopped before them).
    const id = asTenantId(existing.rows[0].id);
    await seedRoleTemplates(id);
    await seedDefaultLeaveTypes(id);
    return id;
  }

  const id = asTenantId(uuidv7());
  const planId = await defaultPlanId(requireMigrationUrl("db/seed-splash-club.ts"));
  await db().query(
    `insert into tenants (id, slug, name, status, plan_id,
                         timezone, currency, gstin, branding)
     values ($1, $2, $3, 'trial', $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      SPLASH.slug,
      SPLASH.name,
      planId,
      SPLASH.timezone,
      SPLASH.currency,
      null,
      JSON.stringify({
        displayName: SPLASH.displayName,
        shortName: SPLASH.shortName,
        accent: "teal",
      }),
    ],
  );

  // The swimming preset brings the programs ("Learn to swim", "Stroke
  // development", "Junior competitive"), the four-lane pool facility,
  // the monthly/quarterly plan shapes and the terminology. It also
  // writes the preset's own marker columns — never set those directly.
  const result = await applyPreset(id, "swimming", { actorId: actor });
  if (result.kind !== "ok") {
    throw new Error(
      `applyPreset(swimming) for ${SPLASH.slug} returned ${result.kind}: ` +
        ("message" in result ? result.message : ""),
    );
  }

  // The standard role templates (owner, admin, receptionist, coach,
  // accountant, worker) are the tenant's own roles — the preset only
  // adds its vertical roles on top. A tenant with no owner role is
  // not a valid tenant (invite-owner looks the role up by key).
  await seedRoleTemplates(id);
  await seedDefaultLeaveTypes(id);

  // The preset's example batches are sample rows with no swimmers.
  // This club's batch is the real one, so the samples go (attendance
  // first — FK to sessions — then sessions, then batches).
  await withTenant(id, async (tx) => {
    await tx.execute(sql`
      delete from attendance
      where tenant_id = ${id}::uuid
        and session_id in (
          select s.id from sessions s
          join batches b on b.id = s.batch_id and b.tenant_id = s.tenant_id
          where b.tenant_id = ${id}::uuid and b.is_sample = true
        )
    `);
    await tx.execute(sql`
      delete from sessions
      where tenant_id = ${id}::uuid
        and batch_id in (
          select id from batches where tenant_id = ${id}::uuid and is_sample = true
        )
    `);
    await tx.execute(sql`
      delete from batches where tenant_id = ${id}::uuid and is_sample = true
    `);
  });

  return id;
}

// applyPreset creates a primary location ("Main Location"). This is
// the pool, so it is renamed and given an address.
async function ensureLocation(tenantId: TenantId): Promise<string> {
  const primary = await db().query<{ id: string }>(
    "select id from locations where tenant_id = $1 and is_primary = true and deleted_at is null",
    [tenantId],
  );
  if (primary.rows.length > 0) {
    const id = primary.rows[0].id;
    await db().query(
      `update locations
          set name = $2,
              address = $3::jsonb
        where id = $1`,
      [id, SPLASH.locationName, JSON.stringify(SPLASH.address)],
    );
    return id;
  }
  const id = uuidv7();
  await db().query(
    `insert into locations (id, tenant_id, name, is_primary, address)
     values ($1, $2, $3, true, $4::jsonb)`,
    [id, tenantId, SPLASH.locationName, JSON.stringify(SPLASH.address)],
  );
  return id;
}

// The three staff rows: a person, a user keyed by phone, a staff row
// (coach/receptionist) and an active membership in the role. The
// owner has no staff row — the owner IS the membership.
async function ensureStaff(tenantId: TenantId): Promise<void> {
  for (const s of STAFF) {
    const personId = uuidv7();
    await db().query(
      `insert into persons (id, tenant_id, full_name)
       values ($1, $2, $3)
       on conflict (id) do nothing`,
      [personId, tenantId, s.fullName],
    );
    const userResult = await db().query<{ id: string }>(
      "select id from users where phone = $1",
      [s.phone],
    );
    let userId: string;
    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      userId = uuidv7();
      await db().query(
        `insert into users (id, phone) values ($1, $2)`,
        [userId, s.phone],
      );
    }
    const roleRow = await db().query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = $2",
      [tenantId, s.role],
    );
    if (roleRow.rows.length === 0) {
      throw new Error(`splash club needs the "${s.role}" role template`);
    }
    if (s.role !== "owner") {
      const staffRow = await db().query<{ id: string }>(
        "select id from staff where tenant_id = $1 and user_id = $2 and staff_type = $3",
        [tenantId, userId, s.role],
      );
      if (staffRow.rows.length === 0) {
        await db().query(
          `insert into staff (id, tenant_id, person_id, user_id, staff_type)
           values ($1, $2, $3, $4, $5)`,
          [uuidv7(), tenantId, personId, userId, s.role],
        );
      }
    }
    await db().query(
      `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
       values (gen_random_uuid(), $1, $2, $3, 'active')
       on conflict (tenant_id, user_id) do nothing`,
      [tenantId, userId, roleRow.rows[0].id],
    );
  }
}

// The PIN the seeded staff sign in with. Set after the users exist,
// so the credential row always has a user to hang off.
async function setStaffCredentials(pin: string): Promise<void> {
  for (const s of STAFF) {
    await setCredentialForPhone(s.phone, pin);
  }
}

async function ensureBatch(
  tenantId: TenantId,
  locationId: string,
): Promise<string> {
  const existing = await db().query<{ id: string }>(
    "select id from batches where tenant_id = $1 and name = $2",
    [tenantId, BATCH.name],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const coach = await db().query<{ id: string }>(
    `select s.id from staff s
       join users u on u.id = s.user_id
      where s.tenant_id = $1 and s.staff_type = 'coach'
      limit 1`,
    [tenantId],
  );
  if (coach.rows.length === 0) {
    throw new Error("splash club needs a coach before it can have a batch");
  }
  const program = await db().query<{ id: string }>(
    `select id from programs where tenant_id = $1 and name = 'Learn to swim' limit 1`,
    [tenantId],
  );
  if (program.rows.length === 0) {
    throw new Error("splash club needs the swimming preset's programs");
  }
  const id = uuidv7();
  await db().query(
    `insert into batches
       (id, tenant_id, program_id, name, capacity, days_of_week,
        start_time, end_time, is_sample, coach_id, location_id, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6::int[], $7, $8, false, $9, $10, null, null)`,
    [
      id,
      tenantId,
      program.rows[0].id,
      BATCH.name,
      BATCH.capacity,
      `{${BATCH.daysOfWeek.join(",")}}`,
      BATCH.startTime,
      BATCH.endTime,
      coach.rows[0].id,
      locationId,
    ],
  );
  return id;
}

async function ensureStudents(
  tenantId: TenantId,
  locationId: string,
  batchId: string,
): Promise<string[]> {
  const memberIds: string[] = [];
  for (const s of STUDENTS) {
    const existing = await db().query<{ id: string }>(
      "select id from members where tenant_id = $1 and member_code = $2",
      [tenantId, s.code],
    );
    if (existing.rows.length > 0) {
      memberIds.push(existing.rows[0].id);
      await enrol(tenantId, existing.rows[0].id, batchId);
      continue;
    }

    const result = await createMember({ tenantId, userId: undefined as never }, {
      fullName: s.fullName,
      dateOfBirth: s.dob,
      memberCode: s.code,
      locationId,
      initialStatus: "active",
      phone: s.phone,
      consents: [
        {
          purpose: "processing",
          policyVersion: "2026.1",
          evidence: { channel: "staff-assisted-in-person" },
        },
      ],
      // A minor needs a guardian row — the registration service
      // refuses one without it (C-05). The seed mirrors the
      // production shape rather than bypassing the guard.
      ...(isMinor(s.dob, SPLASH.timezone)
        ? {
            guardian: {
              fullName: `${s.fullName.split(" ")[0]}'s parent`,
              phone: s.phone,
              relationship: "parent",
            },
          }
        : {}),
    });
    if (!result.ok) {
      throw new Error(`createMember failed for ${s.code} — ${result.error}`);
    }
    memberIds.push(result.memberId);
    await enrol(tenantId, result.memberId, batchId);
  }
  return memberIds;
}

async function enrol(
  tenantId: TenantId,
  memberId: string,
  batchId: string,
): Promise<void> {
  await db().query(
    `insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on)
     select gen_random_uuid(), $1, $2, $3, current_date
     where not exists (
       select 1 from enrolments
       where tenant_id = $1 and member_id = $2 and batch_id = $3
     )`,
    [tenantId, memberId, batchId],
  );
}

// The priced monthly plan. The preset's plan shapes carry no price
// (architecture §7.4), and membership_plans.amount_paise must be
// positive, so the amount is set here for the synthetic club.
async function ensureMonthlyPlan(
  tenantId: TenantId,
  locationId: string,
): Promise<string> {
  const existing = await db().query<{ id: string }>(
    "select id from membership_plans where tenant_id = $1 and name = $2 and deleted_at is null",
    [tenantId, MONTHLY_PLAN.name],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  // The plan is priced for the POOL: membership_plans.activity_id
  // references the facility, not the platform activity catalogue. The
  // swimming preset creates a "Main pool" facility with four lanes.
  const poolFacility = await db().query<{ id: string }>(
    `select id from facilities
      where tenant_id = $1 and kind = 'pool' and deleted_at is null
      order by created_at
      limit 1`,
    [tenantId],
  );
  if (poolFacility.rows.length === 0) {
    throw new Error("splash club needs the swimming preset's pool facility");
  }
  const id = uuidv7();
  await db().query(
    `insert into membership_plans
       (id, tenant_id, location_id, activity_id, name, kind,
        duration_days, sessions, amount_paise, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, null, $8, true)`,
    [
      id,
      tenantId,
      locationId,
      poolFacility.rows[0].id,
      MONTHLY_PLAN.name,
      MONTHLY_PLAN.kind,
      MONTHLY_PLAN.durationDays,
      MONTHLY_PLAN.amountPaise.toString(),
    ],
  );
  return id;
}

// One live subscription, so dues and the nightly renewal invoice have
// something to read. A subscription is a member's plan over time
// (C-30): it starts today and ends when the plan's term ends.
async function ensureSubscription(
  tenantId: TenantId,
  locationId: string,
  memberId: string,
): Promise<void> {
  const existing = await db().query<{ id: string }>(
    "select id from subscriptions where tenant_id = $1 and member_id = $2 and status = 'active'",
    [tenantId, memberId],
  );
  if (existing.rows.length > 0) return;

  const plan = await db().query<{ id: string; duration_days: number }>(
    `select id, duration_days from membership_plans
      where tenant_id = $1 and name = $2 and deleted_at is null
      limit 1`,
    [tenantId, MONTHLY_PLAN.name],
  );
  if (plan.rows.length === 0) {
    throw new Error("splash club needs the monthly plan before a subscription");
  }
  await db().query(
    `insert into subscriptions
       (id, tenant_id, member_id, plan_id, location_id, activity_id,
        starts_on, ends_on, status, auto_renew)
     select gen_random_uuid(), $1, $2, p.id, $3, p.activity_id,
            current_date, current_date + coalesce(p.duration_days, 30), 'active', true
       from membership_plans p
      where p.id = $4`,
    [tenantId, memberId, locationId, plan.rows[0].id],
  );
}
