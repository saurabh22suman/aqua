import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asUserId } from "@/lib/ids";

vi.mock("@/db/platform-tenant-provision", () => ({
  finishTenantProvisioning: vi.fn().mockRejectedValue(new Error("injected follow-up failure")),
}));

import { createLead } from "@/db/platform-leads";
import { convertLead } from "@/db/platform-lead-conversion";

const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const actorId = asUserId(uuidv7());
const run = uuidv7().replaceAll("-", "");

beforeAll(async () => {
  await admin.query(`insert into platform_users (id, email, name, password_hash, password_salt, role, status)
    values ($1, $2, 'Follow-up test', 'h', 's', 'admin', 'active')`, [actorId, `${run}@platform.test`]);
});
afterAll(async () => { await admin.end(); });

it("returns the committed tenant and retry link when postcommit work throws", async () => {
  const lead = await createLead({ businessName: "Follow-up test", contactName: "Test", phone: "+919876543210", source: "other" }, { actorId });
  expect(lead.kind).toBe("ok");
  if (lead.kind !== "ok") return;
  const result = await convertLead(lead.leadId, { slug: `followup-${run}` }, { actorId });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.presetWarning).toMatch(/follow-up failed/i);
  expect((await admin.query("select id from tenants where id = $1", [result.tenantId])).rows).toHaveLength(1);
  expect(await convertLead(lead.leadId, { slug: `followup-retry-${run}` }, { actorId })).toMatchObject({ kind: "error", tenantId: result.tenantId });
});
