import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { locations, programs, batches, members, persons } from "@/db/schema";
import { attendance, sessions } from "@/db/schema/scheduling";
import { asMemberId, asTenantId, asUserId, type TenantId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

// Backend batch 6 — attendance-report regression fixture.
//
// One disposable tenant per test file. The tenant ROW and the
// platform operator are seeded through the shared privileged fixture
// pool (tests/db/privileged-fixture.ts — the credential is named in
// exactly one place, the way the tier1 guard expects); everything the
// report reads is written through withTenant(), so the reads under
// test see exactly the rows the fixture wrote and RLS applies to the
// fixture too.
//
// The fixture deliberately models the shapes the report has to get
// right:
//   * a cancelled session that CARRIES marks (a session cancelled
//     after the coach marked it keeps its attendance rows — see
//     lib/services/session-lifecycle.ts),
//   * a batch whose only session is cancelled,
//   * a batch with both cancelled and non-cancelled sessions,
//   * a partially marked session (recorded marks < roster size),
//   * sessions sitting exactly on the period boundaries.
//
// No member identity is printed: the fixture uses opaque ids and the
// tests assert on counts only.

const LOCATION_SCOPED_KEY = "access.location_scoped_staff" as const;

/** Releases the shared privileged fixture pool. The same pattern the
 *  other privileged-fixture consumers use. */
export async function closeFixturePool(): Promise<void> {
  await admin.end();
}

export const PERIOD = { from: "2026-11-01", to: "2026-12-01" };

export type SessionSpec = {
  /** YYYY-MM-DD, compared against sessions.session_date. */
  date: string;
  status: "scheduled" | "held" | "cancelled";
  /** Recorded marks: member index into the fixture's member list. */
  marks?: Array<{ member: number; status: "present" | "late" | "absent" }>;
};

export type BatchSpec = {
  name: string;
  /** Which of the fixture's three locations the batch runs at.
   *  undefined → location 0; null → a tenant-wide batch
   *  (location_id IS NULL, "the whole business"). */
  location?: 0 | 1 | 2 | null;
  sessions: SessionSpec[];
};

export type TenantFixture = {
  tenantId: TenantId;
  /** [locA, locB, locC] — index 0 is the caller's home location. */
  locationIds: [string, string, string];
  memberIds: string[];
  /** batch name → batch id. */
  batchIds: Map<string, string>;
  /** Unrestricted (all-locations) caller with a resolved identity. */
  ownerCtx: ActionCtx;
  /** Caller restricted to locationIds[0]. */
  scopedCtx: ActionCtx;
  /** The context the report action passes today: tenant only. */
  tenantOnlyCtx: ActionCtx;
  cleanup: () => Promise<void>;
};

/** Turns the O-08 location-scoped-staff boundary ON for one tenant.
 *
 *  The key is OFF by default, so without this the location predicate
 *  is a no-op and every caller sees every location. The write goes
 *  through the platform config path (validated + audited), exactly as
 *  the ops console writes it — the fixture does not reach into the
 *  table directly.
 *
 *  Returns a cleanup that removes the platform actor again. */
export async function enableLocationScopedStaff(
  tenantId: TenantId,
): Promise<() => Promise<void>> {
  const actorId = uuidv7();
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'B6 Platform Operator', 'h', 's', 'admin', 'active')`,
    [actorId, `b6-ops-${actorId}@platform.test`],
  );

  const { setPlatformTenantConfigValue } = await import("@/db/config-admin");
  const result = await setPlatformTenantConfigValue({
    tenantId,
    key: LOCATION_SCOPED_KEY,
    value: true,
    actorId: asUserId(actorId),
  });
  if (!result.ok) {
    throw new Error(`failed to enable location scoping: ${result.error}`);
  }

  return async () => {
    await admin.query("delete from platform_users where id = $1", [actorId]);
  };
}

/** Creates a tenant with two locations, one program, five members and
 *  the requested batches. Everything it creates it also removes. */
export async function createTenantFixture(
  label: string,
  batchSpecs: BatchSpec[],
  options: { memberCount?: number } = {},
): Promise<TenantFixture> {
  const tenantId = asTenantId(uuidv7());
  const run = Date.now().toString(36);
  const memberCount = options.memberCount ?? 5;

  const plan = (
    await admin.query<{ id: string }>(
      "select id from plans where is_default = true",
    )
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, status, plan_id, timezone) values ($1, $2, $3, 'active', $4, 'Asia/Kolkata')",
    [tenantId, `b6-${label}-${run}`, `B6 ${label}`, plan?.id ?? null],
  );

  const locationIds: [string, string, string] = [uuidv7(), uuidv7(), uuidv7()];
  const memberIds: string[] = [];
  const batchIds = new Map<string, string>();

  await withTenant(tenantId, async (tx) => {
    await tx.insert(locations).values([
      { id: locationIds[0], tenantId, name: "Site A", isPrimary: true },
      { id: locationIds[1], tenantId, name: "Site B", isPrimary: false },
      { id: locationIds[2], tenantId, name: "Site C", isPrimary: false },
    ]);

    const [program] = await tx
      .insert(programs)
      .values({ tenantId, name: "B6 Program" })
      .returning({ id: programs.id });

    for (let i = 0; i < memberCount; i += 1) {
      const [person] = await tx
        .insert(persons)
        .values({
          tenantId,
          fullName: `B6 Member ${i}`,
          dateOfBirth: "1990-01-01",
        })
        .returning({ id: persons.id });
      const [member] = await tx
        .insert(members)
        .values({
          tenantId,
          personId: person!.id,
          locationId: locationIds[0],
          memberCode: `b6-${label}-${i}`,
          status: "active",
          joinedOn: "2026-01-01",
        })
        .returning({ id: members.id });
      memberIds.push(member!.id);
    }

    for (const spec of batchSpecs) {
      const batchLocationId =
        spec.location === undefined
          ? locationIds[0]
          : spec.location === null
            ? null
            : locationIds[spec.location];
      const [batch] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId: program!.id,
          name: spec.name,
          capacity: 20,
          daysOfWeek: [1, 3, 5],
          startTime: "06:00",
          endTime: "07:00",
          locationId: batchLocationId,
        })
        .returning({ id: batches.id });
      batchIds.set(spec.name, batch!.id);

      for (const sessionSpec of spec.sessions) {
        const [session] = await tx
          .insert(sessions)
          .values({
            tenantId,
            batchId: batch!.id,
            locationId: batchLocationId,
            sessionDate: sessionSpec.date,
            startsAt: new Date(`${sessionSpec.date}T04:00:00.000Z`),
            endsAt: new Date(`${sessionSpec.date}T05:00:00.000Z`),
            status: sessionSpec.status,
          })
          .returning({ id: sessions.id });

        for (const mark of sessionSpec.marks ?? []) {
          await tx.insert(attendance).values({
            tenantId,
            sessionId: session!.id,
            memberId: asMemberId(memberIds[mark.member]!),
            locationId: locationIds[0],
            status: mark.status,
            clientId: `b6-${label}-${session!.id}-${mark.member}`,
          });
        }
      }
    }
  });

  const cleanup = async () => {
    // Children before parents: attendance → sessions → enrolments →
    // batches → programs → members → persons → locations → tenant.
    await admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from member_status_transitions where tenant_id = $1", [
      tenantId,
    ]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  };

  return {
    tenantId,
    locationIds,
    memberIds,
    batchIds,
    ownerCtx: {
      tenantId,
      userId: asUserId(uuidv7()),
      roleKey: "owner",
      allLocations: true,
      locationIds: [],
      permissions: new Set(["reports.operational"]),
    },
    scopedCtx: {
      tenantId,
      userId: asUserId(uuidv7()),
      roleKey: "admin",
      allLocations: false,
      locationIds: [locationIds[0]],
      permissions: new Set(["reports.operational"]),
    },
    tenantOnlyCtx: { tenantId },
    cleanup,
  };
}
