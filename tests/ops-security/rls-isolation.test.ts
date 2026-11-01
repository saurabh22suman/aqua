// @vitest-environment node
import { randomUUID } from "node:crypto";
import { asTenantId } from "@/lib/ids";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { withTenant } from "@/db/tenant";
import { withPlatform } from "@/db/scope";
import { db, pool } from "@/db/client";
import { locations } from "@/db/schema/locations";

const tenantA = asTenantId(randomUUID()), tenantB = asTenantId(randomUUID());
const locationA = randomUUID(), locationB = randomUUID();
beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name) values($1,$2,'Security A'),($3,$4,'Security B')", [tenantA, `sec-a-${tenantA}`, tenantB, `sec-b-${tenantB}`]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'A',true),($3,$4,'B',true)", [locationA, tenantA, locationB, tenantB]);
});
afterAll(async () => {
  await admin.query("delete from locations where tenant_id=any($1::uuid[])", [[tenantA, tenantB]]);
  await admin.query("delete from tenants where id=any($1::uuid[])", [[tenantA, tenantB]]);
  await admin.end(); await pool.end();
});

describe("Runtime RLS — application role and real transactions", () => {
  it("runs as app_user without superuser or BYPASSRLS privileges", async () => {
    const rows = await withPlatform(async () => await db.execute(sql`select current_user, session_user, rolsuper, rolbypassrls from pg_roles where rolname=current_user`));
    expect(rows.rows[0]).toMatchObject({ current_user: "app_user", session_user: "app_login", rolsuper: false, rolbypassrls: false });
  });
  it("confines unfiltered reads and guessed foreign IDs in concurrent tenant requests", async () => {
    const [a, b] = await Promise.all([
      withTenant(tenantA, tx => tx.select().from(locations)),
      withTenant(tenantB, tx => tx.select().from(locations)),
    ]);
    expect(a.map(r => r.id)).toEqual([locationA]);
    expect(b.map(r => r.id)).toEqual([locationB]);
    expect(await withTenant(tenantA, tx => tx.select().from(locations).where(eq(locations.id, locationB)))).toEqual([]);
  });
  it("refuses a forged tenant insert and prevents update/delete of foreign rows", async () => {
    await expect(withTenant(tenantA, tx => tx.insert(locations).values({ id: randomUUID(), tenantId: tenantB, name: "Forged", isPrimary: false }))).rejects.toThrow();
    expect(await withTenant(tenantA, tx => tx.update(locations).set({ name: "Forged" }).where(eq(locations.id, locationB)).returning())).toEqual([]);
    expect(await withTenant(tenantA, tx => tx.delete(locations).where(eq(locations.id, locationB)).returning())).toEqual([]);
    expect((await admin.query("select name from locations where id=$1", [locationB])).rows[0].name).toBe("B");
  });
  it("clears transaction scope on commit and rollback, including warm pooled connections", async () => {
    await withTenant(tenantA, tx => tx.select().from(locations));
    await expect(withTenant(tenantB, async tx => {
      await tx.select().from(locations); throw new Error("fixture rollback");
    })).rejects.toThrow("fixture rollback");
    for (let i = 0; i < 8; i++) {
      const rows = await withPlatform(async () => await db.select().from(locations).where(and(eq(locations.tenantId, tenantA), eq(locations.id, locationA))));
      expect(rows).toEqual([]);
    }
    expect(await withTenant(tenantB, tx => tx.select({ id: locations.id }).from(locations))).toEqual([{ id: locationB }]);
  });
  it("rejects malformed tenant identities before entering a database scope", async () => {
    await expect(withTenant("not-a-tenant", async () => "unreachable")).rejects.toThrow("not a valid uuid");
  });
});
