import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { validAsset } from "@/lib/branding/asset-reference";
import { writeAudit } from "@/lib/audit/write";
import { asTenantId } from "@/lib/ids";

export type BrandingKind = "logo" | "install_icon";
export type BoundedSource = { read(key: string, maxBytes: number): Promise<Uint8Array | null> };
type State = "absent" | "malformed" | "missing" | "invalid" | "ready";
const MAX_BYTES = 5 * 1024 * 1024;
const kinds: BrandingKind[] = ["logo", "install_icon"];
const field = (kind: BrandingKind) => kind === "logo" ? "logo" : "installIcon";

async function validPng(bytes: Uint8Array, digest: string, kind: BrandingKind): Promise<boolean> {
  if (!bytes.length || bytes.length > MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== digest) return false;
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 1024 * 1024, animated: false });
    const meta = await image.metadata();
    if (meta.format !== "png" || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) return false;
    if (kind === "install_icon" ? meta.width !== 512 || meta.height !== 512 : meta.width > 1024 || meta.height > 1024) return false;
    await image.raw().toBuffer();
    return true;
  } catch { return false; }
}

async function inspect(tx: TenantTx, tenantId: string, branding: Record<string, unknown>, kind: BrandingKind): Promise<State> {
  const raw = branding[field(kind)];
  if (raw == null) return "absent";
  const ref = validAsset(raw, tenantId, kind);
  if (!ref) return "malformed";
  const result = await tx.execute<{ sha256: string; png: Buffer }>(sql`select sha256, png from branding_assets where tenant_id=${tenantId}::uuid and kind=${kind}`);
  const row = result.rows[0];
  if (!row) return "missing";
  if (row.sha256 !== ref.sha256 || !(await validPng(row.png, ref.sha256, kind))) return "invalid";
  return "ready";
}

export async function inventoryBranding(tenantId: string): Promise<Record<BrandingKind, State>> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, asTenantId(tenantId)));
    if (!row) throw new Error("Tenant unavailable");
    return { logo: await inspect(tx, tenantId, row.branding, "logo"), install_icon: await inspect(tx, tenantId, row.branding, "install_icon") };
  });
}

export async function preflightBranding(tenantId: string): Promise<boolean> {
  const status = await inventoryBranding(tenantId);
  return kinds.every((kind) => status[kind] === "absent" || status[kind] === "ready");
}

export async function importLegacyAsset(tenantId: string, kind: BrandingKind, source: BoundedSource): Promise<"imported" | "already_present" | "refused"> {
  if (!kinds.includes(kind)) return "refused";
  const initial = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, asTenantId(tenantId)));
    return validAsset(row?.branding?.[field(kind)], tenantId, kind);
  });
  if (!initial) return "refused";
  let bytes: Uint8Array | null;
  try { bytes = await source.read(initial.objectKey, MAX_BYTES); } catch { return "refused"; }
  if (!bytes || !(await validPng(bytes, initial.sha256, kind))) return "refused";
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, asTenantId(tenantId))).for("update");
    const current = validAsset(row?.branding?.[field(kind)], tenantId, kind);
    if (!current || current.objectKey !== initial.objectKey || current.sha256 !== initial.sha256) return "refused";
    const existing = await tx.execute<{ sha256: string; png: Buffer }>(sql`select sha256, png from branding_assets where tenant_id=${tenantId}::uuid and kind=${kind}`);
    if (existing.rows[0]) return existing.rows[0].sha256 === initial.sha256 && await validPng(existing.rows[0].png, initial.sha256, kind) ? "already_present" : "refused";
    await tx.execute(sql`insert into branding_assets (tenant_id,kind,sha256,png) values (${tenantId}::uuid,${kind},${initial.sha256},${Buffer.from(bytes)})`);
    await writeAudit(tx, { tenantId: asTenantId(tenantId), actorType: "system", action: "branding.asset.import", entityType: "tenant", entityId: tenantId, after: { kind, sha256: initial.sha256 }, changedFields: [field(kind)] });
    return "imported";
  });
}
