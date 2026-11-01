import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";

const tenantId = asTenantId(randomUUID());
const ctx = { tenantId, userId: asUserId(randomUUID()), roleKey: "owner", allLocations: true, permissions: new Set(["dashboard.view"]) };
beforeAll(async () => {
  await admin.query("insert into tenants (id, slug, name, status) values ($1,$2,'Chart access fixture','active')", [tenantId, `chart-access-${tenantId}`]);
  await admin.query("insert into tenant_features (tenant_id,feature_key,enabled) values ($1,'reports',true),($1,'billing',true)", [tenantId]);
});
afterAll(async () => {
  await admin.query("delete from tenant_features where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
});
it.each([
  ["both", ["dashboard.view"]],
  ["financial", ["dashboard.view", "invoices.read"]],
  ["invoices", ["dashboard.view", "reports.financial"]],
])("denies the direct service with missing %s grant despite owner role", async (_label, permissions) => {
  await expect(getOwnerCharts({...ctx, permissions: new Set(permissions)})).rejects.toThrow(/forbidden/i);
});
it("allows a scoped authenticated context with all existing grants", async () => {
  const data = await getOwnerCharts({...ctx, permissions: new Set(["dashboard.view", "reports.financial", "invoices.read"])});
  expect(data.period.key).toBe("last7");
});
it("allows financial readers without dashboard navigation access", async () => {
  const data = await getOwnerCharts({...ctx, permissions: new Set(["reports.financial", "invoices.read"])});
  expect(data.period.key).toBe("last7");
});
it("rejects an identity-free context", async () => {
  await expect(getOwnerCharts({tenantId, permissions: new Set(["dashboard.view", "reports.financial", "invoices.read"])})).rejects.toThrow(/forbidden/i);
});
it.each(["reports", "billing"])("rejects disabled %s even with grants", async feature => {
  await admin.query("update tenant_features set enabled=false where tenant_id=$1 and feature_key=$2", [tenantId,feature]);
  try {
    await expect(getOwnerCharts({...ctx, permissions: new Set(["dashboard.view", "reports.financial", "invoices.read"])})).rejects.toThrow(/feature_disabled/i);
  } finally {
    await admin.query("update tenant_features set enabled=true where tenant_id=$1 and feature_key=$2", [tenantId,feature]);
  }
});
