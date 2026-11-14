import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { reconcileAppPrivileges } from "@/db/app-privileges";
import { env, requireMigrationUrl } from "@/lib/env";
import { uploadBrandingAsset } from "@/lib/services/branding";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

it("retains update denial and scoped delete after repeated bootstrap and reconciliation", async () => {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#123456" } }).png().toBuffer();
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes, mime: "image/png" })).toEqual({ ok: true });
  for (let i = 0; i < 2; i++) {
    await bootstrapRoles(requireMigrationUrl("test"), env.APP_LOGIN_PASSWORD);
    await reconcileAppPrivileges(requireMigrationUrl("test"));
    const grants = await withTenant(f.tenantId, (tx) => tx.execute<{ can_update: boolean; can_delete: boolean; can_insert: boolean; can_select: boolean }>(sql`select has_table_privilege(current_user, 'public.branding_assets', 'UPDATE') can_update, has_table_privilege(current_user, 'public.branding_assets', 'DELETE') can_delete, has_table_privilege(current_user, 'public.branding_assets', 'INSERT') can_insert, has_table_privilege(current_user, 'public.branding_assets', 'SELECT') can_select`));
    expect(grants.rows[0]).toMatchObject({ can_update: false, can_delete: true, can_insert: true, can_select: true });
    await expect(withTenant(f.tenantId, (tx) => tx.execute(sql`update branding_assets set sha256=sha256 where tenant_id=${f.tenantId}::uuid`))).rejects.toThrow();
    const foreign = await withTenant(f.otherTenant, (tx) => tx.execute(sql`delete from branding_assets where tenant_id=${f.tenantId}::uuid returning kind`));
    expect(foreign.rows).toHaveLength(0);
  }
  const deleted = await withTenant(f.tenantId, (tx) => tx.execute(sql`delete from branding_assets where tenant_id=${f.tenantId}::uuid and kind='logo' returning kind`));
  expect(deleted.rows).toHaveLength(1);
});
