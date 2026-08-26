import { and, eq } from "drizzle-orm";
import { planFeatures, plans } from "./schema/platform";
import { tenants } from "./schema/tenants";
import { withTenant } from "./tenant";

export async function resolveTenantFeatureKeys(
  tenantId: string,
): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ featureKey: planFeatures.featureKey })
      .from(tenants)
      .innerJoin(plans, eq(tenants.planId, plans.id))
      .innerJoin(planFeatures, eq(plans.id, planFeatures.planId))
      .where(and(eq(tenants.id, tenantId), eq(plans.status, "active")))
      .orderBy(planFeatures.featureKey);
    return rows.map((r) => r.featureKey);
  });
}
