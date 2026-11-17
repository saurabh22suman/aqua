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
const leadIds = new Set<string>();
const tenantIds = new Set<string>();

beforeAll(async () => {
  await admin.query(`insert into platform_users (id, email, name, password_hash, password_salt, role, status)
    values ($1, $2, 'Follow-up test', 'h', 's', 'admin', 'active')`, [actorId, `${run}@platform.test`]);
});
afterAll(async () => {
  try {
    const linked = await admin.query<{ trial_tenant_id: string | null }>(
      "select trial_tenant_id from platform_leads where id = any($1::uuid[])", [[...leadIds]],
    );
    for (const row of linked.rows) if (row.trial_tenant_id) tenantIds.add(row.trial_tenant_id);
    await admin.query("delete from platform_audit_log where actor_id = $1", [actorId]);
    await admin.query("delete from platform_leads where id = any($1::uuid[])", [[...leadIds]]);
    for (const id of tenantIds) {
      for (const table of ["batches", "programs", "facility_sub_units", "facilities", "skill_levels", "skills", "plan_shapes", "message_templates", "location_presets", "tenant_features", "role_permissions", "roles", "leave_types", "locations"]) {
        await admin.query(`delete from ${table} where tenant_id = $1`, [id]);
      }
      await admin.query("delete from tenants where id = $1", [id]);
    }
    await admin.query("delete from platform_users where id = $1", [actorId]);
    for (const [table, ids] of [["platform_leads", [...leadIds]], ["tenants", [...tenantIds]], ["platform_users", [actorId]]] as const) {
      const remaining = await admin.query(`select id from ${table} where id = any($1::uuid[])`, [ids]);
      expect(remaining.rows).toHaveLength(0);
    }
  } finally {
    await admin.end();
  }
});

it("returns the committed tenant and retry link when postcommit work throws", async () => {
  const lead = await createLead({ businessName: "Follow-up test", contactName: "Test", phone: "+919876543210", source: "other" }, { actorId });
  expect(lead.kind).toBe("ok");
  if (lead.kind !== "ok") return;
  leadIds.add(lead.leadId);
  const result = await convertLead(lead.leadId, { slug: `followup-${run}` }, { actorId });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  tenantIds.add(result.tenantId);
  expect(result.presetWarning).toMatch(/follow-up failed/i);
  expect((await admin.query("select id from tenants where id = $1", [result.tenantId])).rows).toHaveLength(1);
  expect(await convertLead(lead.leadId, { slug: `followup-retry-${run}` }, { actorId })).toMatchObject({ kind: "error", tenantId: result.tenantId });
});
