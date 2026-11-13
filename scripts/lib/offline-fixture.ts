import type { Pool } from "pg";
import { withTenant } from "@/db/tenant";
import { batches } from "@/db/schema";
import { generateSessions } from "@/lib/jobs/session-generator";
import { createMember, enrolMember } from "@/lib/services/register";
import { asTenantId, asStaffId, asUserId } from "@/lib/ids";

export type OfflineFixture = {
  tenantId: string;
  batchId: string;
  sessionId: string;
  memberIds: string[];
  personIds: string[];
};

// An isolated batch/roster/session inside the existing demo-academy tenant
// (not a new tenant — the seeded coach login's default-membership
// resolution would otherwise have to break a tie between two tenants).
// Fresh per run so row-count assertions in scripts/e2e-offline.ts are
// exact, not "16 plus whatever another run left behind".
export async function setupOfflineFixture(
  admin: Pool,
  run: string,
  memberCount: number,
): Promise<OfflineFixture> {
  const tenant = await admin.query<{ id: string }>(
    "select id from tenants where slug = 'demo-academy'",
  );
  if (!tenant.rows[0]) throw new Error("offline fixture: seeded demo tenant is missing");
  const tenantId = asTenantId(tenant.rows[0].id);

  const loc = await admin.query<{ id: string }>(
    "select id from locations where tenant_id = $1 and is_primary = true and deleted_at is null limit 1",
    [tenantId],
  );
  if (!loc.rows[0]) throw new Error("offline fixture: live primary location is missing");
  const locationId = loc.rows[0].id;

  // Use the seeded Owner's current membership and grant, never a synthetic
  // context that claims authority independently of the database.
  const owner = await admin.query<{ id: string }>(
    `select u.id from users u
     join tenant_memberships tm on tm.user_id=u.id and tm.tenant_id=$1
     join roles r on r.id=tm.role_id and r.tenant_id=tm.tenant_id
     join role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id and rp.permission_key='members.write'
     where u.phone='+919000000001' and u.deleted_at is null
       and tm.status='active' and tm.deleted_at is null and r.key='owner' and r.deleted_at is null
       and (tm.all_locations or exists (select 1 from membership_locations ml
         where ml.tenant_id=tm.tenant_id and ml.membership_id=tm.id and ml.location_id=$2))`,
    [tenantId, locationId],
  );
  if (!owner.rows[0]) throw new Error("offline fixture: live seeded owner with members.write is required");
  const ownerCtx = { tenantId, userId: asUserId(owner.rows[0].id) };

  const prog = await admin.query<{ id: string }>(
    "select id from programs where tenant_id = $1 and deleted_at is null limit 1",
    [tenantId],
  );
  if (!prog.rows[0]) throw new Error("offline fixture: live seeded program is missing");
  const programId = prog.rows[0].id;

  // Same demo coach the e2e scripts log in as (loginAsCoach's
  // COACH_PHONE) — assigning it keeps getTodayAction's coach scoping
  // (lib/services/register.ts's listTodaySessions) consistent for this
  // persona too, even though these scripts navigate straight to a
  // known session id rather than through the "today" list.
  // batches.coach_id is a real FK to staff (C-04, migration 0018) --
  // the coach's staff row, not their bare user id. Requires `pnpm
  // seed` to have run first, same as every other assumption this
  // fixture makes about the demo-academy tenant already existing.
  const coach = await admin.query<{ id: string }>(
    `select s.id from staff s
     join users u on u.id = s.user_id
     where u.phone = '+919000000002' and s.tenant_id = $1 and s.staff_type = 'coach'`,
    [tenantId],
  );
  const coachId = coach.rows[0]?.id ? asStaffId(coach.rows[0].id) : undefined;

  let batchId = "";
  await withTenant(tenantId, async (tx) => {
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        locationId,
        name: `Offline Test ${run}`,
        capacity: memberCount,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "06:00",
        endTime: "07:00",
        coachId,
      })
      .returning({ id: batches.id });
    batchId = b.id;
  });

  const memberIds: string[] = [];
  const personIds: string[] = [];
  try {
  for (let i = 1; i <= memberCount; i++) {
    const created = await createMember(
      ownerCtx,
      {
        fullName: `Offline Test Member ${run} ${String(i).padStart(2, "0")}`,
        dateOfBirth: "1990-01-01", // adult -- this fixture isn't testing C-05, sidesteps the guardian/consent flow entirely
        locationId,
        memberCode: `OFF-${run}-${String(i).padStart(2, "0")}`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test-fixture" } },
        ],
      },
    );
    if (!created.ok) throw new Error(`offline fixture: createMember failed — ${created.error}`);
    memberIds.push(created.memberId);
    personIds.push(created.personId);
    const enrolled = await enrolMember(ownerCtx, { memberId: created.memberId, batchId });
    if (!enrolled.ok) throw new Error(`offline fixture: enrolMember failed — ${enrolled.error}`);
  }

  await withTenant(tenantId, (tx) => generateSessions(tx, tenantId, "Asia/Kolkata"));

  const sess = await admin.query<{ id: string }>(
    "select id from sessions where tenant_id = $1 and batch_id = $2 order by starts_at limit 1",
    [tenantId, batchId],
  );
  if (!sess.rows[0]) throw new Error("offline fixture: session generation returned no session");
  const sessionId = sess.rows[0].id;

  return { tenantId, batchId, sessionId, memberIds, personIds };
  } catch (error) {
    try { await cleanupOfflineFixture(admin, { tenantId, batchId, sessionId: "", memberIds, personIds }); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "offline fixture setup and scoped cleanup failed"); }
    throw error;
  }
}

// Each e2e-offline* script sets the flag it needs on its own fixture's
// tenant at setup, rather than relying on whatever the previous script
// in the CI job left behind — order-independent, self-contained, and
// exactly what "per-tenant, not a global env var" is for.
export async function setOfflineSyncEnabled(
  admin: Pool,
  tenantId: string,
  enabled: boolean,
): Promise<void> {
  await admin.query("update tenants set offline_sync_enabled = $1 where id = $2", [
    enabled,
    tenantId,
  ]);
}

export async function cleanupOfflineFixture(admin: Pool, f: OfflineFixture): Promise<void> {
  await admin.query(
    "delete from attendance where tenant_id = $1 and session_id in (select id from sessions where batch_id = $2)",
    [f.tenantId, f.batchId],
  );
  await admin.query("delete from sessions where tenant_id = $1 and batch_id = $2", [f.tenantId, f.batchId]);
  await admin.query("delete from enrolments where tenant_id = $1 and batch_id = $2", [f.tenantId, f.batchId]);
  await admin.query("delete from members where tenant_id = $1 and id = any($2::uuid[])", [f.tenantId, f.memberIds]);
  await admin.query("delete from consents where tenant_id = $1 and person_id = any($2::uuid[])", [f.tenantId, f.personIds]);
  await admin.query("delete from guardianships where tenant_id = $1 and (minor_id = any($2::uuid[]) or guardian_id = any($2::uuid[]))", [f.tenantId, f.personIds]);
  await admin.query("delete from persons where tenant_id = $1 and id = any($2::uuid[])", [f.tenantId, f.personIds]);
  await admin.query("delete from batches where tenant_id = $1 and id = $2", [f.tenantId, f.batchId]);
}

export async function attendanceRows(
  admin: Pool,
  sessionId: string,
): Promise<{ memberId: string; status: string }[]> {
  const { rows } = await admin.query<{ member_id: string; status: string }>(
    "select member_id, status from attendance where session_id = $1",
    [sessionId],
  );
  return rows.map((r) => ({ memberId: r.member_id, status: r.status }));
}
