import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { staffAudienceCandidates } from "@/lib/messaging/notification-enqueue";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("does not target a membership whose role has been withdrawn", async () => {
  await f.admin.query("update roles set deleted_at=now() where tenant_id=$1 and key='manager'", [f.tenantId]);
  const rows = await withTenant(f.tenantId, (tx) => staffAudienceCandidates(tx, { tenantId: f.tenantId }, { allStaff: true }));
  expect(rows.map((row) => row.userId)).toContain(f.userId);
  expect(rows.map((row) => row.userId)).not.toContain(f.managerId);
});

it("does not target a soft-deleted user with an otherwise active membership", async () => {
  await f.admin.query("update roles set deleted_at=null where tenant_id=$1 and key='manager'", [f.tenantId]);
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.managerId]);
  const rows = await withTenant(f.tenantId, (tx) => staffAudienceCandidates(tx, { tenantId: f.tenantId }, { allStaff: true }));
  expect(rows.map((row) => row.userId)).toContain(f.userId);
  expect(rows.map((row) => row.userId)).not.toContain(f.managerId);
});
