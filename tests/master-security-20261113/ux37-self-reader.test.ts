import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import * as service from "@/lib/services/announcements";
import type { SelfScope } from "@/lib/auth/self-scope";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  const a = randomUUID();
  await f.admin.query("insert into announcements(id,tenant_id,title,body,audience,batch_id,sent_at) values($1,$2,'Synthetic batch','Synthetic','batch',$3,now())", [a, f.tenantId, f.batchA]);
  await f.admin.query("insert into notifications(id,tenant_id,user_id,announcement_id,title,body) values($1,$2,$3,$4,'Synthetic batch','Synthetic')", [randomUUID(), f.tenantId, f.userId, a]);
  await f.admin.query("insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')", [randomUUID(), f.tenantId, f.memberId, f.batchA]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from notifications where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from announcements where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("only returns addressed batch messages while the bound child remains in the authorized scope", async () => {
  const api = service as unknown as { readSelfNotificationsInTx?: (tx: unknown, scope: SelfScope) => Promise<Array<{ title: string }>> };
  const scope = { kind: "self_session", audience: "guardian", tenantId: f.tenantId, userId: f.userId, memberId: null, childMemberIds: [f.memberId], linkIds: [randomUUID()], sessionId: randomUUID() } as SelfScope;
  const read = (s: SelfScope) => withTenant(f.tenantId, async (tx) => api.readSelfNotificationsInTx?.(tx, s));
  expect(await read(scope)).toEqual([expect.objectContaining({ title: "Synthetic batch" })]);
  expect(await read({ ...scope, childMemberIds: [] })).toEqual([]);
});

it("does not mark a batch notification read after the child leaves the authorized scope", async () => {
  const api = service as unknown as { markSelfNotificationReadInTx?: (tx: unknown, scope: SelfScope, id: string) => Promise<{ ok: boolean }> };
  const scope = { kind: "self_session", audience: "guardian", tenantId: f.tenantId, userId: f.userId, memberId: null, childMemberIds: [], linkIds: [randomUUID()], sessionId: randomUUID() } as SelfScope;
  const [row] = (await f.admin.query("select id from notifications where tenant_id=$1", [f.tenantId])).rows;
  const result = await withTenant(f.tenantId, async (tx) => api.markSelfNotificationReadInTx?.(tx, scope, row.id));
  expect(result).toMatchObject({ ok: false });
  const saved = await f.admin.query("select read_at from notifications where id=$1", [row.id]);
  expect(saved.rows[0].read_at).toBeNull();
});

it("returns older eligible messages when fifty newer addressed batches are no longer eligible", async () => {
  const id = randomUUID();
  await f.admin.query("insert into announcements(id,tenant_id,title,body,audience,batch_id,sent_at) values($1,$2,'Other batch','Synthetic','batch',$3,now())", [id, f.tenantId, f.batchB]);
  await f.admin.query("insert into notifications(id,tenant_id,user_id,announcement_id,title,body,created_at) select gen_random_uuid(),$1,$2,$3,'Other batch','Synthetic',now()+interval '1 second' from generate_series(1,50)", [f.tenantId, f.userId, id]);
  const scope: SelfScope = { kind: "self_session", audience: "guardian", tenantId: f.tenantId, userId: f.userId, memberId: null, childMemberIds: [f.memberId], linkIds: [randomUUID()], sessionId: randomUUID() };
  const rows = await withTenant(f.tenantId, (tx) => service.readSelfNotificationsInTx(tx, scope));
  expect(rows.map((row) => row.title)).toContain("Synthetic batch");
});
