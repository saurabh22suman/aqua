// The splash-history seed finds its tenant WITHOUT a privileged
// connection.
//
// The seed used to open its own migration-role pool just to read one
// row (`select id, name from tenants where slug = …`) and then wrote
// through withTenant(). That made a LOCAL-ONLY seed script a
// superuser consumer, and it put the privileged connection's name in a
// file the tier1 no-superuser guard has to police.
//
// The lookup is now a PLATFORM read: withPlatformAdmin() uses the
// application's own pool with the platform_admin SELECT policy, which is
// the same path db/platform-tenant-create.ts already uses to create a
// tenant. This test proves the lookup works on that path — the tenant
// row is created through the application pool, and the seed finds it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { withPlatformAdmin } from "@/db/scope";
import { tenants } from "@/db/schema/tenants";
import { findSplashTenantBySlug } from "@/db/seed-splash-history";
import { asTenantId } from "@/lib/ids";
import { privilegedFixturePool as admin } from "./privileged-fixture";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const slug = `splash-history-lookup-${RUN}`;

let tenantId = "";

beforeAll(async () => {
  tenantId = uuidv7();
  // Created through the APPLICATION pool, exactly as the platform
  // console creates a tenant — so the lookup below cannot be relying on
  // a privileged connection to see it.
  await withPlatformAdmin(async (tx) => {
    await tx.insert(tenants).values({
      id: asTenantId(tenantId),
      slug,
      name: "Splash History Lookup",
      timezone: TZ,
    });
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("splash history tenant lookup", () => {
  it("finds the synthetic tenant by slug through the application pool", async () => {
    const found = await findSplashTenantBySlug(slug);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(tenantId);
    expect(found!.name).toBe("Splash History Lookup");
  });

  it("returns null for an unknown slug instead of throwing", async () => {
    await expect(findSplashTenantBySlug(`no-such-tenant-${RUN}`)).resolves.toBeNull();
  });
});
