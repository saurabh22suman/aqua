import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { resolveAudienceUserIds } from "@/lib/services/announcement-audience";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("excludes staff with withdrawn roles from the all-audience inbox fan-out", async () => {
  await f.admin.query("update roles set deleted_at=now() where tenant_id=$1 and key='manager'", [f.tenantId]);
  const ids = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, "all"));
  expect(ids).toContain(f.userId);
  expect(ids).not.toContain(f.managerId);
});

it("excludes a soft-deleted user from all-audience fan-out", async () => {
  await f.admin.query("update roles set deleted_at=null where tenant_id=$1 and key='manager'", [f.tenantId]);
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.managerId]);
  const ids = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, "all"));
  expect(ids).toContain(f.userId);
  expect(ids).not.toContain(f.managerId);
});
