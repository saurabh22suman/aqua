import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { plans } from "./schema/platform";
import type { TenantTx } from "./tenant";

export type CataloguePlan = {
  id: string; key: string; name: string; status: string;
  pricePaise: bigint | null; currency: string;
  isDefault: boolean; availableForNewTenants: boolean;
};

// Same audited plan.list boundary as the catalogue/filter. Availability is
// separate from status: legacy plans stay active for existing entitlements.
export async function listOpsPlanCatalogue(): Promise<CataloguePlan[]> {
  return withPlatform(async () => db.select({
    id: plans.id, key: plans.key, name: plans.name, status: plans.status,
    pricePaise: plans.pricePaise, currency: plans.currency,
    isDefault: plans.isDefault, availableForNewTenants: plans.availableForNewTenants,
  }).from(plans).orderBy(plans.sortOrder, plans.name));
}

export async function listActivePlans(): Promise<Array<{ key: string; name: string; isDefault: boolean }>> {
  return withPlatform(async () => db.select({
    key: plans.key, name: plans.name, isDefault: plans.isDefault,
  }).from(plans).where(and(eq(plans.status, "active"), eq(plans.availableForNewTenants, true)))
    .orderBy(plans.sortOrder, plans.name));
}

// Runs inside createTenant's existing atomic platform-admin transaction.
// Form filtering alone cannot refuse a forged legacy/deprecated plan key.
export async function findSignupPlan(tx: TenantTx, planKey?: string) {
  const rows = await tx.select({ id: plans.id, name: plans.name, key: plans.key })
    .from(plans).where(and(
      eq(plans.status, "active"), eq(plans.availableForNewTenants, true),
      planKey ? eq(plans.key, planKey) : eq(plans.isDefault, true),
    )).limit(1);
  return rows[0] ?? null;
}

// The eligible target plan, HELD for the rest of the transaction.
//
// findSignupPlan above is a plain read: under READ COMMITTED the plan
// it found can be deactivated before the caller's transaction commits,
// and the write would then assign a plan that is no longer assignable.
//
// This helper takes a SHARED lock on the plan row (`FOR SHARE`) and
// re-checks the eligibility predicate AFTER the lock is held. A
// concurrent deactivation is an UPDATE of that row, which conflicts
// with the shared lock, so it cannot land until this transaction
// commits. The plan that was checked is therefore the plan that is
// still eligible at commit.
//
// createTenant keeps using findSignupPlan; its API and its behaviour
// are unchanged.
export async function lockEligibleSignupPlan(
  tx: TenantTx,
  planKey: string,
): Promise<{ id: string; name: string; key: string } | null> {
  const rows = await tx.execute<{
    id: string;
    name: string;
    key: string;
    status: string;
    availableForNewTenants: boolean;
  }>(sql`
    select id,
           name,
           key,
           status,
           available_for_new_tenants as "availableForNewTenants"
    from plans
    where key = ${planKey}
    for share
  `);
  const row = (
    rows as unknown as {
      rows: Array<{
        id: string;
        name: string;
        key: string;
        status: string;
        availableForNewTenants: boolean;
      }>;
    }
  ).rows[0];
  if (!row) return null;
  if (row.status !== "active" || !row.availableForNewTenants) return null;
  return { id: row.id, name: row.name, key: row.key };
}
