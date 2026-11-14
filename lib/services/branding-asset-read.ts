import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import type { ActionCtx } from "@/lib/auth/context";
import { validAsset } from "@/lib/branding/asset-reference";
import { readBrandingPng } from "@/lib/services/branding-png-store";

/** Caller supplies a server-resolved tenant; stale asset versions fail closed. */
export async function readBrandingLogo(ctx: Pick<ActionCtx, "tenantId">, digest: string): Promise<Uint8Array | null> {
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  try { return await withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const ref = validAsset(row?.branding?.logo, ctx.tenantId, "logo");
    return ref && ref.sha256 === digest ? readBrandingPng(tx, ctx.tenantId, "logo", digest) : null;
  }); } catch { return null; }
}
