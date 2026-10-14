import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { NotFoundError, requireDefaultCtx } from "@/lib/auth/context";
import { withPlatform } from "@/db/scope";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { eq } from "drizzle-orm";
import { OFFLINE_SYNC_ENABLED } from "@/lib/feature-flags";
import { isCoachLikeRoleKey } from "@/lib/services/resource-access";
import type { OfflineIdentity } from "./identity";

export async function offlineSessionState(): Promise<{ authenticated: boolean; identity: OfflineIdentity | null }> {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h,
    query: { disableCookieCache: true, disableRefresh: true } }));
  if (!session) return { authenticated: false, identity: null };
  try {
    const ctx = await requireDefaultCtx();
    const [tenant] = await withTenant(ctx.tenantId, tx => tx.select({ enabled: tenants.offlineSyncEnabled })
      .from(tenants).where(eq(tenants.id, ctx.tenantId)));
    if (!isCoachLikeRoleKey(ctx.roleKey) || !OFFLINE_SYNC_ENABLED || !tenant?.enabled) return { authenticated: true, identity: null };
    const scope = createHash("sha256").update(`${ctx.tenantId}:${ctx.userId}:${ctx.membershipId}:${session.session.id}`).digest("hex");
    return { authenticated: true, identity: { scope, expiresAt: session.session.expiresAt.getTime() } };
  } catch (error) {
    if (error instanceof NotFoundError) return { authenticated: false, identity: null };
    throw error;
  }
}
