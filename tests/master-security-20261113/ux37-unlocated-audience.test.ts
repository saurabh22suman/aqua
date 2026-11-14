import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { resolveAudienceUserIds } from "@/lib/services/announcement-audience";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("does not send a whole-academy batch to a facility-limited manager", async () => {
  const ids = await withTenant(f.tenantId, (tx) => resolveAudienceUserIds(tx, f.tenantId, "batch", f.batchUnlocated));
  expect(ids).toContain(f.userId);
  expect(ids).not.toContain(f.managerId);
});
