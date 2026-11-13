import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { listMyNotifications, markNotificationRead } from "@/lib/services/announcements";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  const id = randomUUID();
  await f.admin.query("insert into announcements(id,tenant_id,title,body,audience,sent_at) values($1,$2,'Synthetic update','Synthetic body','all',now())", [id, f.tenantId]);
  await f.admin.query("insert into notifications(id,tenant_id,user_id,announcement_id,title,body) values($1,$2,$3,$4,'Synthetic update','Synthetic body')", [randomUUID(), f.tenantId, f.managerId, id]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from notifications where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from announcements where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("stops exposing addressed announcements after staff membership revocation", async () => {
  const ctx = f.context(f.managerId, "manager");
  expect(await listMyNotifications(ctx)).toHaveLength(1);
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.managerMembership]);
  expect(await listMyNotifications(ctx)).toEqual([]);
});

it("does not expose an addressed batch announcement outside the manager's live location", async () => {
  await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.managerMembership]);
  const id = randomUUID();
  await f.admin.query("insert into announcements(id,tenant_id,title,body,audience,batch_id,sent_at) values($1,$2,'Private batch','Synthetic body','batch',$3,now())", [id, f.tenantId, f.batchB]);
  await f.admin.query("insert into notifications(id,tenant_id,user_id,announcement_id,title,body) values($1,$2,$3,$4,'Private batch','Synthetic body')", [randomUUID(), f.tenantId, f.managerId, id]);
  const rows = await listMyNotifications(f.context(f.managerId, "manager"));
  expect(rows.map((row) => row.title)).not.toContain("Private batch");
  expect(rows.map((row) => row.title)).toContain("Synthetic update");
});

it("refuses a revoked staff member's attempt to mark an addressed notification read", async () => {
  const [row] = (await f.admin.query("select id from notifications where tenant_id=$1 and title='Synthetic update'", [f.tenantId])).rows;
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.managerMembership]);
  expect(await markNotificationRead(f.context(f.managerId, "manager"), row.id)).toMatchObject({ ok: false });
});

it("returns older eligible messages when fifty newer addressed messages are out of scope", async () => {
  await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.managerMembership]);
  const id = randomUUID();
  await f.admin.query("insert into announcements(id,tenant_id,title,body,audience,batch_id,sent_at) values($1,$2,'Other location','Synthetic','batch',$3,now())", [id, f.tenantId, f.batchB]);
  await f.admin.query("insert into notifications(id,tenant_id,user_id,announcement_id,title,body,created_at) select gen_random_uuid(),$1,$2,$3,'Out of scope','Synthetic',now()+interval '1 second' from generate_series(1,50)", [f.tenantId, f.managerId, id]);
  expect((await listMyNotifications(f.context(f.managerId, "manager"))).map((row) => row.title)).toContain("Synthetic update");
});
