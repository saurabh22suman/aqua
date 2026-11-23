import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { cancelSession } from "@/lib/services/session-lifecycle";

let f: Awaited<ReturnType<typeof fixture>>;
const sessionId = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2) and permission_key='programs.write'", [f.tenantId, f.receptionistId]);
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,'2026-11-13','2026-11-13T10:00Z','2026-11-13T11:00Z')", [sessionId, f.tenantId, f.batchA, f.locationA, f.coachId]);
});
afterAll(async () => { await f?.cleanup(); });

it("refuses missing or incomplete human authority, while an explicitly marked system can act", async () => {
  // @ts-expect-error Verify the runtime boundary still fails closed for malformed callers.
  expect(await cancelSession({ tenantId: f.tenantId }, sessionId)).toMatchObject({ kind: "error", code: "forbidden" });
  expect(await cancelSession({ tenantId: f.tenantId, userId: f.receptionistId }, sessionId)).toMatchObject({ kind: "error", code: "forbidden" });
  const before = await f.admin.query("select status from sessions where id=$1", [sessionId]);
  expect(before.rows[0].status).not.toBe("cancelled");
  expect(await cancelSession({ tenantId: f.tenantId, systemActor: true }, sessionId)).toMatchObject({ kind: "ok" });
  const { rows: [audit] } = await f.admin.query("select actor_type,actor_id,source from audit_log where tenant_id=$1 and entity_id=$2 and action='session.cancel.notification'", [f.tenantId, sessionId]);
  expect(audit).toMatchObject({ actor_type: "system", actor_id: null, source: "job" });
});
