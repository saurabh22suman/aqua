import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { requireMigrationUrl } from "@/lib/env";
import { seedPlatformCatalogue } from "@/db/seed-platform";
import { defaultPlanId } from "@/db/seed-platform";
import { seedRoleTemplates } from "@/lib/services/roles";
import { setCredentialForPhone } from "@/lib/services/credentials";
import { pool } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import { facilities } from "@/db/schema/preset-engine";
import { members } from "@/db/schema/people";
import { persons } from "@/db/schema/people";
import { tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { bookingPriceRules } from "@/db/schema/bookings";
import { eq } from "drizzle-orm";
import { asUserId, type TenantId } from "@/lib/ids";

// Batch 6 — browser-evidence fixture.
//
// A disposable academy an owner can log into: one location, one
// bookable facility, a priced rule, a member to book for, and an
// owner login (phone + PIN). It runs against the harness's disposable
// test database, never against a club's data.
//
//   pnpm exec tsx tests/backend-b6/bookings/fixtures/seed-browser-fixture.ts
//
// Prints the phone and PIN the browser walkthrough uses.

const SLUG = "b6-browser-academy";
const TZ = "Asia/Kolkata";
const PHONE = "+91 90000 00601";
const PIN = "123456";

const admin = new Pool({
  connectionString: requireMigrationUrl("tests/backend-b6/bookings/fixtures/seed-browser-fixture.ts"),
});

async function main() {
  const migrationUrl = requireMigrationUrl(
    "tests/backend-b6/bookings/fixtures/seed-browser-fixture.ts",
  );
  await seedPlatformCatalogue(migrationUrl);

  const existing = await admin.query<{ id: string }>(
    "select id from tenants where slug = $1",
    [SLUG],
  );
  const tenantId = (existing.rows[0]?.id ?? uuidv7()) as TenantId;

  if (existing.rows.length === 0) {
    const planId = await defaultPlanId(migrationUrl);
    await admin.query(
      "insert into tenants (id, slug, name, status, plan_id, timezone) values ($1,$2,'Booking Browser Academy','active',$3,$4)",
      [tenantId, SLUG, planId, TZ],
    );
    console.log(`tenant ${SLUG} → ${tenantId}`);
  }

  await seedRoleTemplates(tenantId);

  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Browser Pool", isPrimary: true })
      .onConflictDoNothing()
      .returning({ id: locations.id });
    const locationId = loc?.id ?? (
      await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.tenantId, tenantId))
        .limit(1)
    )[0]!.id;

    const [facility] = await tx
      .insert(facilities)
      .values({
        tenantId,
        locationId,
        name: "Swimming Pool",
        kind: "pool",
        capacity: 8,
      })
      .returning({ id: facilities.id });
    const facilityId = facility!.id;

    await tx
      .insert(bookingPriceRules)
      .values({
        tenantId,
        facilityId,
        label: "Lane hire",
        daysOfWeek: [],
        startTime: null,
        endTime: null,
        pricePaise: 40_000n,
        priority: 0,
        isActive: true,
      })
      .onConflictDoNothing();

    const [person] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Aarav Sharma" })
      .returning({ id: persons.id });
    await tx
      .insert(members)
      .values({
        tenantId,
        personId: person!.id,
        locationId,
        memberCode: "B6-M001",
        status: "active",
      })
      .onConflictDoNothing();

    console.log(`location → ${locationId}`);
    console.log(`facility → ${facilityId}`);
  });

  await setCredentialForPhone(PHONE, PIN);

  const user = await admin.query<{ id: string }>(
    "select id from users where phone = $1",
    ["+919000000601"],
  );
  const userId = asUserId(user.rows[0]!.id);

  await withTenant(tenantId, async (tx) => {
    const ownerRole = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .limit(1);
    const roleId = ownerRole[0]!.id;
    await tx
      .insert(tenantMemberships)
      .values({
        tenantId,
        userId,
        roleId,
        allLocations: true,
        status: "active",
      })
      .onConflictDoNothing();
    const roleKey = await tx
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);
    console.log(`membership role → ${roleKey[0]?.key}`);
  });

  console.log(`\nlogin phone: ${PHONE}\nlogin pin:   ${PIN}`);
  await admin.end();
  await pool.end().catch(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
