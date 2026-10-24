import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { execFileSync } from "node:child_process";

// The Splash Sports Club seeder (db/seed-splash-club.ts) is what a
// deployment uses to get a demo club out of an empty database. This
// runs it against a REAL fresh Postgres 16 — the same one `pnpm
// db:deploy` prepares for a first deployment — and asserts what it
// writes, because a seeder that writes the wrong shape is worse than
// no seeder: the deployment looks healthy and the demo data is
// wrong.
//
// The database is a throwaway container, so nothing here touches the
// configured test database.

let container: StartedPostgreSqlContainer;
let client: Client;

const SEED_ENV = {
  SEED_SPLASH_CLUB: "true",
  SEED_SPLASH_CLUB_PIN: "246810",
};

// The seeder takes its configuration as arguments (db/deploy.ts
// passes the validated env), so the tests can call it with different
// settings without re-importing anything — and without the module
// resets that would leave a second app pool behind.
async function loadSeeder() {
  const mod = await import("@/db/seed-splash-club");
  return mod.seedSplashSportsClub;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AQUA_NO_DOTENV: "1",
    NODE_ENV: "test",
    DATABASE_URL: `postgresql://app_login:splash-seed-test@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
    MIGRATION_DATABASE_URL: container.getConnectionUri(),
    APP_LOGIN_PASSWORD: "splash-seed-test",
    BETTER_AUTH_SECRET: "splash-seed-test-secret-that-is-long-enough",
    PARENT_LINK_SECRET: "splash-seed-test-parent-link-secret",
    ...SEED_ENV,
  };
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.MIGRATION_DATABASE_URL = env.MIGRATION_DATABASE_URL;
  process.env.APP_LOGIN_PASSWORD = env.APP_LOGIN_PASSWORD;
  process.env.BETTER_AUTH_SECRET = env.BETTER_AUTH_SECRET;
  process.env.PARENT_LINK_SECRET = env.PARENT_LINK_SECRET;
  process.env.SEED_SPLASH_CLUB = env.SEED_SPLASH_CLUB!;
  process.env.SEED_SPLASH_CLUB_PIN = env.SEED_SPLASH_CLUB_PIN!;
  // A real first deployment: bootstrap roles, then migrations. The
  // seeder builds on that schema exactly as the deploy step does.
  execFileSync("pnpm", ["db:deploy"], { env, timeout: 180_000, stdio: "pipe" });
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
}, 180_000);

afterAll(async () => {
  // The app pool (db/client) holds connections to the container;
  // close it before the container goes, or the driver reports the
  // teardown as an uncaught error.
  const { pool } = await import("@/db/client");
  await pool.end();
  await client?.end();
  await container?.stop();
});

describe("Splash Sports Club seeder", () => {
  it("refuses to run without the flag", async () => {
    const seedSplashSportsClub = await loadSeeder();
    await expect(
      seedSplashSportsClub({ enabled: false, pin: SEED_ENV.SEED_SPLASH_CLUB_PIN }),
    ).rejects.toThrow(/SEED_SPLASH_CLUB/);
  });

  it("refuses to run without a usable PIN", async () => {
    // A seeded club whose staff cannot sign in is useless, and a
    // DEFAULT pin on a public host is a credential everybody can use.
    const seedSplashSportsClub = await loadSeeder();
    await expect(seedSplashSportsClub({ enabled: true, pin: "123" })).rejects.toThrow(
      /SEED_SPLASH_CLUB_PIN/,
    );
  });

  it("seeds the club, its staff, students, batch, plan and subscription", async () => {
    const seedSplashSportsClub = await loadSeeder();
    const result = await seedSplashSportsClub({
      enabled: true,
      pin: SEED_ENV.SEED_SPLASH_CLUB_PIN,
    });
    expect(result.staffCount).toBe(3);
    expect(result.memberIds).toHaveLength(8);

    const { rows: [tenant] } = await client.query(
      `select slug, name, preset_key, status from tenants where slug = 'splash-sports-club'`,
    );
    expect(tenant).toMatchObject({
      slug: "splash-sports-club",
      name: "Splash Sports Club",
      preset_key: "swimming",
    });

    // The pool, and the swimming preset's own content.
    const { rows: [location] } = await client.query(
      `select l.name, l.is_primary from locations l
         join tenants t on t.id = l.tenant_id
        where t.slug = 'splash-sports-club'`,
    );
    expect(location).toMatchObject({ name: "Splash Pool", is_primary: true });

    const { rows: facilities } = await client.query(
      `select f.name, f.kind from facilities f
         join tenants t on t.id = f.tenant_id
        where t.slug = 'splash-sports-club'`,
    );
    expect(facilities).toEqual([{ name: "Main pool", kind: "pool" }]);

    const { rows: programs } = await client.query(
      `select p.name from programs p
         join tenants t on t.id = p.tenant_id
        where t.slug = 'splash-sports-club' order by p.name`,
    );
    expect(programs.map((r) => r.name)).toEqual([
      "Junior competitive",
      "Learn to swim",
      "Stroke development",
    ]);

    // The three staff the operator asked for, as active memberships.
    const { rows: memberships } = await client.query(
      `select r.key from tenant_memberships tm
         join roles r on r.id = tm.role_id
         join tenants t on t.id = tm.tenant_id
        where t.slug = 'splash-sports-club' and tm.status = 'active'
        order by r.key`,
    );
    expect(memberships.map((r) => r.key)).toEqual([
      "coach",
      "owner",
      "receptionist",
    ]);

    // Staff rows: coach + receptionist. The owner IS the membership.
    const { rows: staff } = await client.query(
      `select s.staff_type from staff s
         join tenants t on t.id = s.tenant_id
        where t.slug = 'splash-sports-club' order by s.staff_type`,
    );
    expect(staff.map((r) => r.staff_type)).toEqual(["coach", "receptionist"]);

    // Students, their guardians (the minors) and the batch.
    const { rows: [students] } = await client.query(
      `select count(*)::int as n from members m
         join tenants t on t.id = m.tenant_id
        where t.slug = 'splash-sports-club'`,
    );
    expect(students.n).toBe(8);

    const { rows: [guardianships] } = await client.query(
      `select count(*)::int as n from guardianships g
         join tenants t on t.id = g.tenant_id
        where t.slug = 'splash-sports-club'`,
    );
    // The three minors in the seed (2012, 2013, 2015) each need one.
    expect(guardianships.n).toBe(3);

    const { rows: [batch] } = await client.query(
      `select b.name, b.capacity, array_to_string(b.days_of_week, ',') as days,
              to_char(b.start_time, 'HH24:MI') as start_time
         from batches b
         join tenants t on t.id = b.tenant_id
        where t.slug = 'splash-sports-club'`,
    );
    expect(batch).toEqual({
      name: "Evening Squad",
      capacity: 16,
      days: "1,3,5",
      start_time: "18:00",
    });

    const { rows: [enrolments] } = await client.query(
      `select count(*)::int as n from enrolments e
         join tenants t on t.id = e.tenant_id
        where t.slug = 'splash-sports-club'`,
    );
    expect(enrolments.n).toBe(8);

    // The priced plan on the pool, and a live subscription on it.
    const { rows: [plan] } = await client.query(
      `select mp.name, mp.amount_paise, mp.duration_days, f.name as facility
         from membership_plans mp
         join tenants t on t.id = mp.tenant_id
         left join facilities f on f.id = mp.activity_id
        where t.slug = 'splash-sports-club'`,
    );
    expect(plan).toMatchObject({
      name: "Monthly Swimming",
      amount_paise: "300000",
      duration_days: 30,
      facility: "Main pool",
    });

    const { rows: [subscription] } = await client.query(
      `select s.status, s.auto_renew, s.ends_on > s.starts_on as spans
         from subscriptions s
         join tenants t on t.id = s.tenant_id
        where t.slug = 'splash-sports-club'`,
    );
    expect(subscription).toMatchObject({ status: "active", auto_renew: true, spans: true });

    // The staff can actually sign in: a credential row per phone.
    const { rows: credentials } = await client.query(
      `select u.email from ba_user u
         join ba_account a on a.user_id = u.id
        where a.password is not null and u.email like '+9190000002%'`,
    );
    expect(credentials).toHaveLength(3);
  });

  it("is idempotent — a redeploy duplicates nothing", async () => {
    const seedSplashSportsClub = await loadSeeder();
    await seedSplashSportsClub({
      enabled: true,
      pin: SEED_ENV.SEED_SPLASH_CLUB_PIN,
    });
    const { rows: [counts] } = await client.query(
      `select
         (select count(*)::int from tenants where slug = 'splash-sports-club') as tenants,
         (select count(*)::int from members m join tenants t on t.id = m.tenant_id
           where t.slug = 'splash-sports-club') as members,
         (select count(*)::int from batches b join tenants t on t.id = b.tenant_id
           where t.slug = 'splash-sports-club') as batches,
         (select count(*)::int from enrolments e join tenants t on t.id = e.tenant_id
           where t.slug = 'splash-sports-club') as enrolments,
         (select count(*)::int from subscriptions s join tenants t on t.id = s.tenant_id
           where t.slug = 'splash-sports-club') as subscriptions,
         (select count(*)::int from membership_plans mp join tenants t on t.id = mp.tenant_id
           where t.slug = 'splash-sports-club') as plans`,
    );
    expect(counts).toEqual({
      tenants: 1,
      members: 8,
      batches: 1,
      enrolments: 8,
      subscriptions: 1,
      plans: 1,
    });
  });
});
