import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../../remediation-20261112/fixture";
import { holdFirstRead } from "../../remediation-20261112/query-gate";
import { rescheduleSession } from "@/lib/services/session-lifecycle";
import { substituteCoach } from "@/lib/services/coach-substitution";

let f: Awaited<ReturnType<typeof fixture>>, coach2: string, a: string, b: string;
beforeEach(async () => {
  f = await fixture(); coach2 = randomUUID(); a = randomUUID(); b = randomUUID();
  const person = randomUUID();
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Synthetic second coach')", [person, f.tenantId]);
  await f.admin.query("insert into staff(id,tenant_id,person_id,staff_type) values($1,$2,$3,'coach')", [coach2, f.tenantId, person]);
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$3,$4,$6,$8,'2026-11-15','2026-11-15T04:00Z','2026-11-15T05:00Z'),($2,$3,$5,$7,$9,'2026-11-15','2026-11-15T06:00Z','2026-11-15T07:00Z')", [a,b,f.tenantId,f.batchA,f.batchB,f.locationA,f.locationB,f.coachId,coach2]);
});
afterEach(async () => { if (f) await f.cleanup(); });

it.each(["move-first", "substitute-first"] as const)("serializes reschedule versus substitution: %s", async order => {
  const gate = holdFirstRead(/"sessions"\."starts_at"\s*</i, /pg_advisory_xact_lock/i);
  const move = () => rescheduleSession(f.context(), { sessionId: a, newSessionDate: "2026-11-15", newStartsAt: new Date("2026-11-15T06:00Z"), newEndsAt: new Date("2026-11-15T07:00Z") });
  const substitute = () => substituteCoach(f.context(), { sessionId: b, newCoachId: f.coachId });
  try {
    const first = order === "move-first" ? move() : substitute(); await gate.reached;
    const second = order === "move-first" ? substitute() : move();
    await gate.waitForCompetition(f.admin, second); gate.release();
    const results = await Promise.all([first, second]);
    expect(results[0]).toMatchObject({ kind: "ok" });
    expect(results[1]).toMatchObject({ kind: "error", code: "coach_conflict" });
    const rows = await f.admin.query<{id: string; coach_id: string; starts_at: Date}>("select id,coach_id,starts_at from sessions where id=any($1::uuid[])", [[a,b]]);
    const firstRow = rows.rows.find(row => row.id === a), secondRow = rows.rows.find(row => row.id === b);
    expect(firstRow?.starts_at.toISOString()).toBe(order === "move-first" ? "2026-11-15T06:00:00.000Z" : "2026-11-15T04:00:00.000Z");
    expect(secondRow?.coach_id).toBe(order === "move-first" ? coach2 : f.coachId);
    const audits = await f.admin.query<{action: string}>("select action from audit_log where tenant_id=$1 and entity_id=any($2::uuid[]) and action in ('session.substitute','session.reschedule.notification')", [f.tenantId,[a,b]]);
    expect(audits.rows.map(row => row.action)).toEqual([order === "move-first" ? "session.reschedule.notification" : "session.substitute"]);
  } finally { gate.close(); }
}, 15000);

it("allows simultaneous equal-time moves for different coaches", async () => {
  const gate = holdFirstRead(/"sessions"\."starts_at"\s*</i, /pg_advisory_xact_lock/i);
  const input = { newSessionDate: "2026-11-16", newStartsAt: new Date("2026-11-16T06:00Z"), newEndsAt: new Date("2026-11-16T07:00Z") };
  try {
    const first = rescheduleSession(f.context(), { ...input, sessionId: a }); await gate.reached;
    const second = rescheduleSession(f.context(), { ...input, sessionId: b });
    await gate.waitForCompetition(f.admin, second); gate.release();
    expect((await Promise.all([first, second])).map(result => result.kind)).toEqual(["ok", "ok"]);
  } finally { gate.close(); }
}, 15000);

it("refuses overlapping cross-coach swaps without deadlock", async () => {
  await f.admin.query("update sessions set starts_at='2026-11-15T04:00Z',ends_at='2026-11-15T05:00Z' where id=$1", [b]);
  const gate = holdFirstRead(/"sessions"\."starts_at"\s*</i, /pg_advisory_xact_lock/i);
  try {
    const first = substituteCoach(f.context(), { sessionId: a, newCoachId: coach2 }); await gate.reached;
    const second = substituteCoach(f.context(), { sessionId: b, newCoachId: f.coachId });
    await gate.waitForCompetition(f.admin, second); gate.release();
    const results = await Promise.all([first, second]);
    expect(results).toEqual([expect.objectContaining({ kind: "error", code: "coach_conflict" }), expect.objectContaining({ kind: "error", code: "coach_conflict" })]);
    const rows = await f.admin.query<{id: string; coach_id: string}>("select id,coach_id from sessions where id=any($1::uuid[])", [[a,b]]);
    expect(rows.rows.find(row => row.id === a)?.coach_id).toBe(f.coachId);
    expect(rows.rows.find(row => row.id === b)?.coach_id).toBe(coach2);
  } finally { gate.close(); }
}, 15000);

it("ignores another cancelled session when checking coach conflicts", async () => {
  await f.admin.query("update sessions set status='cancelled',coach_id=$1 where id=$2", [f.coachId,b]);
  expect(await rescheduleSession(f.context(), { sessionId: a, newSessionDate: "2026-11-15", newStartsAt: new Date("2026-11-15T06:00Z"), newEndsAt: new Date("2026-11-15T07:00Z") })).toMatchObject({kind:"ok",newStatus:"scheduled"});
});
