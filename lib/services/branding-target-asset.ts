import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { validAsset } from "@/lib/branding/asset-reference";
import { getObjectStore, type ObjectStore } from "@/lib/storage/object-store";
import { asTenantId } from "@/lib/ids";
import { brandingIconVariant } from "@/lib/branding/prepare-image";
import { brandDataFrom } from "@/lib/services/branding";

/** Called only inside an authorized target read transaction. */
export async function readTargetLogo(tx: TenantTx, tenantId: string, digest: string, store?: ObjectStore): Promise<Uint8Array | null> {
  return readAsset(tx, tenantId, digest, "logo", store);
}

async function readAsset(tx: TenantTx, tenantId: string, digest: string, kind: "logo" | "install_icon", store?: ObjectStore): Promise<Uint8Array | null> {
  const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, asTenantId(tenantId)));
  const ref = validAsset(kind === "logo" ? row?.branding?.logo : row?.branding?.installIcon, tenantId, kind);
  if (!ref || ref.sha256 !== digest) return null;
  try {
    const bytes = await (store ?? getObjectStore()).getObject(ref.objectKey);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== digest) return null;
    return bytes;
  } catch { return null; }
}

export async function readTargetIcon(tx: TenantTx, tenantId: string, digest: string, size: 192 | 512, store?: ObjectStore): Promise<Uint8Array | null> {
  const bytes = await readAsset(tx, tenantId, digest, "install_icon", store);
  return bytes ? brandingIconVariant(bytes, size) : null;
}

export async function readTargetManifestData(tx: TenantTx, tenantId: string): Promise<{ name: string; iconDigest: string | null } | null> {
  const [row] = await tx.select({ name: tenants.name, branding: tenants.branding }).from(tenants).where(eq(tenants.id, asTenantId(tenantId)));
  if (!row) return null;
  const branding = brandDataFrom(row.name, row.branding);
  const icon = validAsset(row.branding?.installIcon, tenantId, "install_icon");
  return { name: branding.displayName ?? branding.fallbackDisplayName, iconDigest: icon?.sha256 ?? null };
}
