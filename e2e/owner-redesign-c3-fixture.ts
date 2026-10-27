#!/usr/bin/env tsx
/**
 * Owner redesign · Operations lane (C3) — the browser-evidence fixture.
 *
 * The calendar probe needs three shapes the demo club does not have:
 *
 *   * a session BEFORE the 06:00 working window, so the probe can
 *     prove the ruler grows instead of clipping supported data;
 *   * TWO sessions that overlap and share the coach who runs them, so
 *     the probe can prove the blocks sit side by side and that the
 *     clash marker appears for a real exclusive resource;
 *   * a session that runs past midnight, so the probe can prove the
 *     label says which day the end is on.
 *
 * These are SYNTHETIC rows in this lane's DISPOSABLE test database.
 * They are never used by the application and never touch a development
 * or customer database.
 *
 * SAFETY — the guard is checked BEFORE the first read or write:
 *
 *   1. AQUA_HARNESS_TEST_DATABASE=disposable and AQUA_NO_DOTENV=1, the
 *      two markers the harness writes into its private profile;
 *   2. both connection URLs must name a LOCAL host and the SAME
 *      aqua_test_* database;
 *   3. the runtime URL must use the app_login role and the migration
 *      URL the aqua role;
 *   4. the ACTUAL current_database() and current_user() of both
 *      connections must match that database and role — the URL is a
 *      claim, the session is the proof.
 *
 * Every write runs inside withTenant(), with the application role and
 * the tenant's RLS context.
 */
import { Pool } from "pg";
import { assertDisposableTarget, assertSession } from "@/tests/db/owner-browser-fixture";
import { and, eq, inArray, like } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import {
  batches,
  bookings,
  bookingPriceRules,
  facilities,
  locations,
  members,
  programs,
  sessions,
  staff,
  tenantFeatures,
} from "@/db/schema";
import { asTenantId } from "@/lib/ids";

const SLUG = process.env.AQUA_E2E_TENANT_SLUG ?? "demo-academy";
/** The synthetic batch's name — the fixture is idempotent on it. */
const SYNTHETIC_BATCH = "Calendar probe sessions";
/** The synthetic bookable facility — idempotent on its name. */
const PROBE_FACILITY = "Probe Main Court";

/** The IST wall clock for a date and a "HH:MM" time, as an instant. */
function istInstant(dateIso: string, wall: string): Date {
  // IST is UTC+05:30 with no daylight saving.
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = wall.split(":").map(Number);
  return new Date(
    Date.UTC(year!, month! - 1, day!, hour! - 5, minute! - 30, 0),
  );
}

async function main() {
  const guard = assertDisposableTarget();
  const admin = new Pool({ connectionString: guard.migration.toString() });
  try {
    await assertSession(admin, guard.database, ["aqua"], "the migration connection");
    const found = await admin
      .query<{ id: string }>(
        `select id::text as id from tenants where slug = $1 limit 1`,
        [SLUG],
      )
      .then((result) => result.rows);
    const tenant = found[0];
    if (!tenant) throw new Error(`no tenant with the slug ${SLUG}`);
    const tenantId = tenant.id;

    await withTenant(tenantId, async (tx) => {
      const scoped = asTenantId(tenantId);

      // The fixture is idempotent AND self-healing: whatever a previous
      // run left under the probe names is removed first, so a repeated
      // run cannot double the rows.
      const stale = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(
          and(
            eq(batches.tenantId, scoped),
            like(batches.name, `${SYNTHETIC_BATCH}%`),
          ),
        );
      if (stale.length > 0) {
        const staleIds = stale.map((row) => row.id);
        await tx
          .delete(sessions)
          .where(
            and(eq(sessions.tenantId, scoped), inArray(sessions.batchId, staleIds)),
          );
        await tx
          .delete(batches)
          .where(
            and(eq(batches.tenantId, scoped), inArray(batches.id, staleIds)),
          );
        console.log(`removed ${staleIds.length} stale probe batches`);
      }

      const location = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.tenantId, scoped))
        .limit(1);
      const locationId = location[0]?.id ?? null;

      // The coach that runs both overlapping sessions. The seed gives
      // the demo club one coach; any coach will do, the probe only
      // needs the two sessions to share one.
      const coach = await tx
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.tenantId, scoped))
        .limit(1);
      const coachId = coach[0]?.id ?? null;

      const program = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(eq(programs.tenantId, scoped))
        .limit(1);
      if (!program[0]) throw new Error("the tenant has no program");

      // One batch per shape: a tenant may hold only ONE session of a
      // batch on a day (the unique key is tenant + batch + date), so
      // the overlapping pair needs two batches that share the coach.
      const shapes = [
        { key: "early", name: "Early probe", start: "05:30", end: "06:30" },
        { key: "overlap-a", name: "Overlap probe A", start: "18:00", end: "19:00" },
        { key: "overlap-b", name: "Overlap probe B", start: "18:30", end: "19:30" },
        { key: "midnight", name: "Midnight probe", start: "23:00", end: "00:30" },
      ];
      const batchIds = new Map<string, string>();
      for (const shape of shapes) {
        const [batch] = await tx
          .insert(batches)
          .values({
            tenantId: scoped,
            programId: program[0].id,
            name: `${SYNTHETIC_BATCH} · ${shape.name}`,
            capacity: 12,
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            startTime: `${shape.start}:00`,
            endTime: `${shape.end}:00`,
            coachId,
            locationId,
          })
          .returning({ id: batches.id });
        if (!batch) throw new Error(`could not insert the ${shape.key} batch`);
        batchIds.set(shape.key, batch.id);
      }

      // The week the demo club's "today" falls in, so the probe always
      // has something to look at. The academy's zone is Asia/Kolkata.
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });

      let written = 0;
      for (let offset = 0; offset < 7; offset++) {
        const date = new Date(`${today}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + offset);
        const iso = date.toISOString().slice(0, 10);
        for (const shape of shapes) {
          const startsAt = istInstant(iso, shape.start);
          // A session that crosses midnight ends on the NEXT calendar
          // day, ninety minutes after it starts — not a whole day
          // later.
          const nextDay = new Date(`${iso}T00:00:00Z`);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const endsAt =
            shape.end <= shape.start
              ? istInstant(nextDay.toISOString().slice(0, 10), shape.end)
              : istInstant(iso, shape.end);
          await tx.insert(sessions).values({
            tenantId: scoped,
            batchId: batchIds.get(shape.key)!,
            locationId,
            sessionDate: iso,
            startsAt,
            endsAt,
            status: "scheduled",
            coachId,
          });
          written++;
        }
      }
      console.log(
        `calendar probe sessions seeded → ${written} sessions from ${today}`,
      );

      // ── The booking desk ────────────────────────────────────────
      // A bookable facility, the entitlement that puts the desk on
      // show, a configured price and bookings across SEVERAL days, so
      // the desk's Day and Week views both have real content. These
      // are fixture rows in a disposable database — the product's
      // entitlements and permissions are untouched.
      await tx
        .insert(tenantFeatures)
        .values({
          tenantId: scoped,
          featureKey: "pool.booking",
          enabled: true,
          config: {},
        })
        .onConflictDoNothing();

      const existingFacility = await tx
        .select({ id: facilities.id })
        .from(facilities)
        .where(
          and(eq(facilities.tenantId, scoped), eq(facilities.name, PROBE_FACILITY)),
        )
        .limit(1);
      let facilityId = existingFacility[0]?.id;
      if (!facilityId) {
        if (!locationId) throw new Error("the tenant has no location");
        const [facility] = await tx
          .insert(facilities)
          .values({
            tenantId: scoped,
            locationId,
            name: PROBE_FACILITY,
            kind: "court",
            capacity: 8,
          })
          .returning({ id: facilities.id });
        facilityId = facility!.id;
      }

      const existingRule = await tx
        .select({ id: bookingPriceRules.id })
        .from(bookingPriceRules)
        .where(
          and(
            eq(bookingPriceRules.tenantId, scoped),
            eq(bookingPriceRules.facilityId, facilityId),
          ),
        )
        .limit(1);
      if (existingRule.length === 0) {
        await tx.insert(bookingPriceRules).values({
          tenantId: scoped,
          facilityId,
          label: "Court hire",
          daysOfWeek: [],
          startTime: null,
          endTime: null,
          pricePaise: 50_000n,
          priority: 0,
          isActive: true,
        });
      }

      const bookableMember = await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.tenantId, scoped))
        .limit(1);
      const memberId = bookableMember[0]?.id ?? null;

      // Two bookings a day, on four days, so the desk's week view has
      // content on more than one day. The EXCLUDE constraint is
      // respected: they are on the same facility but never overlap.
      let booked = 0;
      for (let offset = 0; offset < 4; offset++) {
        const date = new Date(`${today}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + offset);
        const iso = date.toISOString().slice(0, 10);
        for (const [start, end] of [
          ["10:00", "11:00"],
          ["18:00", "19:00"],
        ] as const) {
          const startsAt = istInstant(iso, start);
          const endsAt = istInstant(iso, end);
          const clash = await tx
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.tenantId, scoped),
                eq(bookings.facilityId, facilityId),
                eq(bookings.startsAt, startsAt),
              ),
            )
            .limit(1);
          if (clash.length > 0) continue;
          await tx.insert(bookings).values({
            tenantId: scoped,
            locationId: locationId!,
            facilityId,
            memberId,
            startsAt,
            endsAt,
            status: "confirmed",
            pricePaise: 50_000n,
          });
          booked++;
        }
      }
      console.log(
        `booking desk fixture → facility ${facilityId}, price rule set, ${booked} bookings from ${today}`,
      );
    });
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
