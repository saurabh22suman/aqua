import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { createSubscription } from "@/lib/services/subscriptions";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it.each([
  ["duration", 30, undefined, "2024-03-29"],
  ["term", 30, undefined, "2024-03-29"],
  ["sessions", null, undefined, "2024-05-28"],
  ["duration", 30, "2024-03-15", "2024-03-15"],
] as const)("preserves inclusive %s subscription terms", async (kind, duration, explicit, expected) => {
  const planId = randomUUID();
  await f.admin.query("insert into membership_plans(id,tenant_id,name,kind,duration_days,sessions,amount_paise,location_id) values($1,$2,'Synthetic terms',$3,$4,$5,10000,$6)", [planId, f.tenantId, kind, duration, kind === "sessions" ? 10 : null, f.locationA]);
  const result = await createSubscription(f.context(), { memberId: f.memberId, planId, startsOn: "2024-02-29", ...(explicit ? { endsOn: explicit } : {}) });
  expect(result.ok).toBe(true);
  const { rows } = await f.admin.query("select ends_on::text from subscriptions where tenant_id=$1 and plan_id=$2", [f.tenantId, planId]);
  expect(rows[0]?.ends_on).toBe(expected);
});

it("rejects an explicit end before the start", async () => {
  const result = await createSubscription(f.context(), { memberId: f.memberId, planId: f.planId, startsOn: "2024-02-29", endsOn: "2024-02-28" });
  expect(result.ok).toBe(false);
});
