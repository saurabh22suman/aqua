import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../../remediation-20261112/fixture";
import { rescheduleSession } from "@/lib/services/session-lifecycle";

let f: Awaited<ReturnType<typeof fixture>>, id: string;
beforeAll(async () => {
  f = await fixture(); id = randomUUID();
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,'2026-11-01','2026-11-01T04:00Z','2026-11-01T05:00Z')", [id, f.tenantId, f.batchA, f.locationA, f.coachId]);
});
afterAll(async () => { if (f) await f.cleanup(); });
it("rejects an invalid Date without throwing or writing", async () => {
  const result = await rescheduleSession(f.context(), { sessionId: id, newSessionDate: "2026-11-02", newStartsAt: new Date("invalid"), newEndsAt: new Date("2026-11-02T05:00Z") });
  expect(result).toMatchObject({ kind: "error", code: "invalid" });
});
it("rejects a date that disagrees with the tenant-local start across midnight", async () => {
  const result = await rescheduleSession(f.context(), { sessionId: id, newSessionDate: "2026-11-02", newStartsAt: new Date("2026-11-02T19:00:00Z"), newEndsAt: new Date("2026-11-02T20:00:00Z") });
  expect(result).toMatchObject({ kind: "error", code: "invalid" });
});
it("detects a coach conflict that crosses local midnight", async () => {
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,'2026-11-02','2026-11-02T18:00Z','2026-11-02T19:00Z')", [randomUUID(), f.tenantId, f.batchB, f.locationB, f.coachId]);
  const result = await rescheduleSession(f.context(), { sessionId: id, newSessionDate: "2026-11-03", newStartsAt: new Date("2026-11-02T18:40Z"), newEndsAt: new Date("2026-11-02T19:10Z") });
  expect(result).toMatchObject({ kind: "error", code: "coach_conflict" });
});
