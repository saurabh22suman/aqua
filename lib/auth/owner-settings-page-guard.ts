import { notFound } from "next/navigation";
import { withTenant } from "@/db/tenant";
import type { ActionCtx } from "@/lib/auth/context";
import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";

// Presentation checks are prefilters; mutations recheck in their own tx.
export function isLiveOwnerForSettings(ctx: ActionCtx): Promise<boolean> {
  return withTenant(ctx.tenantId, (tx) => callerIsLiveOwnerForSettingsOrDelegation(tx, ctx));
}

export async function requireLiveOwnerSettingsPage(ctx: ActionCtx): Promise<void> {
  if (!(await isLiveOwnerForSettings(ctx))) {
    notFound();
  }
}
