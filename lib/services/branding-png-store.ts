import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";

type Kind = "logo" | "install_icon";

export async function hasBrandingPngRow(tx: TenantTx, tenantId: string, kind: Kind, digest: string): Promise<boolean> {
  const result = await tx.execute(sql`select 1 from branding_assets where tenant_id = ${tenantId}::uuid and kind = ${kind} and sha256 = ${digest}`);
  return result.rows.length === 1;
}

export async function readBrandingPng(tx: TenantTx, tenantId: string, kind: Kind, digest: string): Promise<Uint8Array | null> {
  const result = await tx.execute<{ png: Buffer; sha256: string }>(sql`
    select png, sha256 from branding_assets
    where tenant_id = ${tenantId}::uuid and kind = ${kind} and sha256 = ${digest}
  `);
  const row = result.rows[0];
  if (!row || createHash("sha256").update(row.png).digest("hex") !== digest) return null;
  return row.png;
}

export async function replaceBrandingPng(tx: TenantTx, tenantId: string, kind: Kind, digest: string, png: Uint8Array): Promise<void> {
  await tx.execute(sql`delete from branding_assets where tenant_id = ${tenantId}::uuid and kind = ${kind}`);
  await tx.execute(sql`insert into branding_assets (tenant_id, kind, sha256, png) values (${tenantId}::uuid, ${kind}, ${digest}, ${Buffer.from(png)})`);
}
