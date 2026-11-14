import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("denies an identity-free caller unless it explicitly identifies as system", async () => {
  const missing = await withTenant(f.tenantId, (tx) => resolveLocationAccess(tx, { tenantId: f.tenantId }));
  const system = await withTenant(f.tenantId, (tx) => resolveLocationAccess(tx, { tenantId: f.tenantId, systemActor: true }));
  expect(locationVisible(missing, f.locationA)).toBe(false);
  expect(locationVisible(system, f.locationA)).toBe(true);
});
