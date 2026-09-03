"use server";

import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import { asTenantId } from "@/lib/ids";

// Phase 4 (reports) — small auxiliary action that resolves a
// tenant's IANA timezone. The reports page uses it to compute
// "this calendar month" correctly for any tenant, not just the
// default Asia/Kolkata. The reports themselves are otherwise
// date-only and never look at the timezone directly — this
// helper just keeps the period pick honest.

export async function getTenantTimezoneAction(): Promise<string> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, asTenantId(ctx.tenantId)))
      .limit(1);
    return row?.timezone ?? "Asia/Kolkata";
  });
}