import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { previewAnnouncementAudience } from "@/lib/services/announcements";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,m.role_id,'messaging.send' from tenant_memberships m where m.tenant_id=$1 and m.user_id=any($2::uuid[])", [f.tenantId, [f.userId, f.managerId]]); });
afterAll(async () => { await f?.cleanup(); });

it("does not preview a whole-academy audience for a facility-limited manager", async () => {
  const ctx = f.context(f.managerId, "manager");
  ctx.permissions.add("messaging.send");
  expect((await previewAnnouncementAudience(ctx, { audience: "all" })).ok).toBe(false);
});
