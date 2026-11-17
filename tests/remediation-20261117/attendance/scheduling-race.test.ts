import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../../remediation-20261112/fixture";
import { holdFirstRead } from "../../remediation-20261112/query-gate";
import { cancelSession, rescheduleSession } from "@/lib/services/session-lifecycle";
let f: Awaited<ReturnType<typeof fixture>>, a: string, b: string;
beforeAll(async () => {
  f = await fixture(); a = randomUUID(); b = randomUUID();
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$3,$4,$6,$8,'2026-11-10','2026-11-10T04:00Z','2026-11-10T05:00Z'),($2,$3,$5,$7,$8,'2026-11-11','2026-11-11T04:00Z','2026-11-11T05:00Z')", [a,b,f.tenantId,f.batchA,f.batchB,f.locationA,f.locationB,f.coachId]);
});
afterAll(async () => { if (f) await f.cleanup(); });
it("serializes competing reschedules for the same coach", async () => {
  const gate = holdFirstRead(/"sessions"\."starts_at"\s*</i, /pg_advisory_xact_lock/i);
  const input = { newSessionDate: "2026-11-12", newStartsAt: new Date("2026-11-12T04:00Z"), newEndsAt: new Date("2026-11-12T05:00Z") };
  try {
    const first = rescheduleSession(f.context(), { ...input, sessionId: a });
    await gate.reached;
    const second = rescheduleSession(f.context(), { ...input, sessionId: b });
    await gate.waitForCompetition(f.admin, second);
    gate.release();
    const results = await Promise.all([first, second]);
    expect(results.filter(result => result.kind === "ok")).toHaveLength(1);
    expect(results.filter(result => result.kind === "error" && result.code === "coach_conflict")).toHaveLength(1);
  } finally { gate.close(); }
}, 15000);

it.each(["cancel-first", "reschedule-first"] as const)("serializes cancellation and reschedule: %s", async order => {
  const id = randomUUID(), date = order === "cancel-first" ? "2026-11-20" : "2026-11-21";
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)", [id,f.tenantId,f.batchA,f.locationA,date,`${date}T04:00Z`,`${date}T05:00Z`]);
  const input = { sessionId: id, newSessionDate: date, newStartsAt: new Date(`${date}T06:00Z`), newEndsAt: new Date(`${date}T07:00Z`) };
  const gate = holdFirstRead(/from "sessions".*for update/i);
  try {
    const first = order === "cancel-first" ? cancelSession(f.context(), id) : rescheduleSession(f.context(), input);
    await gate.reached;
    const second = order === "cancel-first" ? rescheduleSession(f.context(), input) : cancelSession(f.context(), id);
    await gate.waitForCompetition(f.admin, second);
    gate.release();
    const results = await Promise.all([first, second]);
    expect(results.map(result => result.kind)).toEqual(["ok", "ok"]);
    const row = await f.admin.query<{status: string}>("select status from sessions where id=$1", [id]);
    expect(row.rows[0]?.status).toBe(order === "cancel-first" ? "scheduled" : "cancelled");
    const audits = await f.admin.query<{action: string}>("select action from audit_log where tenant_id=$1 and entity_id=$2 and action in ('session.cancel.notification','session.reschedule.notification') order by id", [f.tenantId, id]);
    expect(audits.rows.map(row => row.action)).toEqual(order === "cancel-first"
      ? ["session.cancel.notification", "session.reschedule.notification"]
      : ["session.reschedule.notification", "session.cancel.notification"]);
    const outbox = await f.admin.query<{event_key: string}>("select distinct event_key from whatsapp_notification_outbox where tenant_id=$1 and event_key like $2", [f.tenantId, `session:${id}:%`]);
    expect(outbox.rows.some(row => row.event_key.startsWith(`session:${id}:cancelled:`))).toBe(true);
    expect(outbox.rows.some(row => row.event_key.startsWith(`session:${id}:rescheduled:`))).toBe(true);
  } finally { gate.close(); }
}, 15000);
