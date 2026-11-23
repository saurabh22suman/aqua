import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { generateSessions } from "@/lib/jobs/session-generator";
import { addDays, todayInZone, weekdayOf } from "@/lib/time/tz";
import { holdFirstRead } from "../../remediation-20261112/query-gate";
import { rescheduleSession } from "@/lib/services/session-lifecycle";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { if (f) await f.cleanup(); });
it("retains the approved advisory batch conflict policy when generating sessions", async () => {
  const today = todayInZone("Asia/Kolkata");
  const date = addDays(today, (1 - weekdayOf(today) + 7) % 7);
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), f.tenantId, f.batchB, f.locationB, f.coachId, date, `${date}T04:45Z`, `${date}T05:15Z`]);
  await expect(withTenant(f.tenantId, tx => generateSessions(tx, f.tenantId, "Asia/Kolkata"))).resolves.toBeGreaterThan(0);
  const rows = await f.admin.query("select id from sessions where tenant_id=$1 and batch_id=$2 and session_date=$3", [f.tenantId, f.batchA, date]);
  expect(rows.rowCount).toBe(1);
});
it("serializes generator and reschedule without changing advisory generation policy", async () => {
  const id = randomUUID();
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,'2027-01-01','2027-01-01T04:00Z','2027-01-01T05:00Z')", [id,f.tenantId,f.batchA,f.locationA]);
  const gate = holdFirstRead(/from "batches"/i, /pg_advisory_xact_lock/i);
  try {
    const generation = withTenant(f.tenantId, tx => generateSessions(tx, f.tenantId, "Asia/Kolkata"));
    await gate.reached;
    const move = rescheduleSession(f.context(), { sessionId: id, newSessionDate: "2027-01-01", newStartsAt: new Date("2027-01-01T06:00Z"), newEndsAt: new Date("2027-01-01T07:00Z") });
    await gate.waitForCompetition(f.admin, move); gate.release();
    await generation;
    expect(await move).toMatchObject({ kind: "ok", newStatus: "scheduled" });
    const rows = await f.admin.query<{starts_at: Date}>("select starts_at from sessions where id=$1", [id]);
    expect(rows.rows[0]?.starts_at.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  } finally { gate.close(); }
}, 15000);
