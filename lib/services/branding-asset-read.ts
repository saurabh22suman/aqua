import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import type { ActionCtx } from "@/lib/auth/context";
import { validAsset } from "@/lib/branding/asset-reference";
import { getObjectStore, type ObjectStore } from "@/lib/storage/object-store";

/** Caller supplies a server-resolved tenant; stale asset versions fail closed. */
export async function readBrandingLogo(ctx: Pick<ActionCtx, "tenantId">, digest: string, store: ObjectStore = getObjectStore()): Promise<Uint8Array | null> {
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  const ref = await withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    return validAsset(row?.branding?.logo, ctx.tenantId, "logo");
  });
  if (!ref || ref.sha256 !== digest) return null;
  try { return await store.getObject(ref.objectKey); } catch { return null; }
}
