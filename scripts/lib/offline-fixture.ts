import type { Pool } from "pg";
import { withTenant } from "@/db/tenant";
import { batches } from "@/db/schema";
import { generateSessions } from "@/lib/jobs/session-generator";
import { createMember, enrolMember } from "@/lib/services/register";

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
  const tenantId = tenant.rows[0].id;

  const loc = await admin.query<{ id: string }>(
    "select id from locations where tenant_id = $1 and is_primary = true limit 1",
    [tenantId],
  );
  const locationId = loc.rows[0].id;

  const prog = await admin.query<{ id: string }>(
    "select id from programs where tenant_id = $1 limit 1",
    [tenantId],
  );
  const programId = prog.rows[0].id;

  // Same demo coach the e2e scripts log in as (loginAsCoach's
  // COACH_PHONE) — assigning it keeps getTodayAction's coach scoping
  // (lib/services/register.ts's listTodaySessions) consistent for this
  // persona too, even though these scripts navigate straight to a
  // known session id rather than through the "today" list.
  const coach = await admin.query<{ id: string }>(
    "select id from users where phone = '+919000000002'",
  );
  const coachId = coach.rows[0]?.id;

  let batchId = "";
  await withTenant(tenantId, async (tx) => {
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
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
  for (let i = 1; i <= memberCount; i++) {
    const created = await createMember(
      { tenantId, userId: undefined as unknown as string },
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
    await enrolMember({ tenantId }, { memberId: created.memberId, batchId });
  }

  await withTenant(tenantId, (tx) => generateSessions(tx, tenantId, "Asia/Kolkata"));

  const sess = await admin.query<{ id: string }>(
    "select id from sessions where tenant_id = $1 and batch_id = $2 order by starts_at limit 1",
    [tenantId, batchId],
  );
  const sessionId = sess.rows[0].id;

  return { tenantId, batchId, sessionId, memberIds, personIds };
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
  await admin.query("delete from sessions where batch_id = $1", [f.batchId]);
  await admin.query("delete from enrolments where batch_id = $1", [f.batchId]);
  await admin.query("delete from members where id = any($1)", [f.memberIds]);
  await admin.query("delete from consents where person_id = any($1)", [f.personIds]);
  await admin.query("delete from guardianships where minor_id = any($1) or guardian_id = any($1)", [f.personIds]);
  await admin.query("delete from persons where id = any($1)", [f.personIds]);
  await admin.query("delete from batches where id = $1", [f.batchId]);
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
