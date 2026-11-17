import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { listMyNotifications, markNotificationRead } from "@/lib/services/announcements";

let f: Awaited<ReturnType<typeof fixture>>;
const notificationId = randomUUID();
beforeAll(async () => {
  f = await fixture();
  const announcementId = randomUUID();
  await f.admin.query("insert into announcements(id,tenant_id,title,body,audience,sent_at) values($1,$2,'Guardian only','Synthetic','parents',now())", [announcementId, f.tenantId]);
  await f.admin.query("insert into notifications(id,tenant_id,user_id,announcement_id,title,body) values($1,$2,$3,$4,'Guardian only','Synthetic')", [notificationId, f.tenantId, f.managerId, announcementId]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from notifications where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from announcements where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("does not revive guardian-only notifications through a later staff membership", async () => {
  const ctx = f.context(f.managerId, "manager");
  expect((await listMyNotifications(ctx)).map((row) => row.id)).not.toContain(notificationId);
  expect(await markNotificationRead(ctx, notificationId)).toMatchObject({ ok: false });
});
