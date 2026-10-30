// @vitest-environment node
//
// Lane c-money — a concurrent duplicate subscription is refused with a
// clear message, not a raw database error (F-08).
//
// A member may hold only one active subscription to a given plan. The
// service's pre-check says so in the user's words; the partial unique
// index subscriptions_active_member_plan_uidx is the concurrency
// backstop. The backstop had no translation, so the request that lost
// the race surfaced the driver's own error text instead of the
// message the rest of the service uses.
//
// This is the only part of F-08 in scope: '.parse throws on malformed
// input' is NOT a defect (AGENTS permits Zod parse then authorization).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { createSubscription } from "@/lib/services/subscriptions";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const RUN = Date.now().toString(36);
const tenantId: TenantId = asTenantId(uuidv7());
const locationA = uuidv7();
const personA = uuidv7();
const memberA = uuidv7();
const planA = uuidv7();

const ctx = {
  tenantId,
  userId: asUserId(randomUUID()),
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["members.write", "members.read"]),
};

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Sub Club', 'active', 'Asia/Kolkata')",
    [tenantId, `sub-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)",
    [locationA, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Sub Member')",
    [personA, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberA, tenantId, personA, locationA, `SUB-${RUN}`],
  );
  await admin.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly', 'duration', 30, 100000)",
    [planA, tenantId, locationA],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    ctx.userId,
    `+9166${RUN}${String(1).padStart(3, "0")}`,
  ]);
}, 120_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from subscriptions where tenant_id = $1", [tenantId]);
  await admin.query("delete from membership_plans where tenant_id = $1", [tenantId]);
  await admin.query("delete from members where tenant_id = $1", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.query("delete from users where phone like $1", [`+9166${RUN}%`]);
  await admin.end();
}, 120_000);

describe("a duplicate active subscription is refused in the user's words (F-08)", () => {
  it("refuses the loser of a concurrent race with the same message", async () => {
    const [first, second] = await Promise.all([
      createSubscription(ctx, { memberId: memberA, planId: planA }),
      createSubscription(ctx, { memberId: memberA, planId: planA }),
    ]);

    const results = [first, second];
    expect(results.filter((result) => result.ok).length).toBe(1);

    const refused = results.find((result) => !result.ok);
    expect(refused).toBeDefined();
    expect(refused!.ok === false && refused!.error).toMatch(
      /already has an active subscription/i,
    );

    const rows = await admin.query(
      "select id from subscriptions where tenant_id = $1 and member_id = $2 and plan_id = $3 and status = 'active'",
      [tenantId, memberA, planA],
    );
    expect(rows.rows).toHaveLength(1);
  }, 60_000);

  it("still refuses a sequential duplicate with the same message", async () => {
    // A second member and plan, so this case does not depend on the
    // one above.
    const personB = uuidv7();
    const memberB = uuidv7();
    const planB = uuidv7();
    await admin.query(
      "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Sub Member B')",
      [personB, tenantId],
    );
    await admin.query(
      "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
      [memberB, tenantId, personB, locationA, `SUB-B-${RUN}`],
    );
    await admin.query(
      "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly B', 'duration', 30, 100000)",
      [planB, tenantId, locationA],
    );

    const first = await createSubscription(ctx, {
      memberId: memberB,
      planId: planB,
    });
    expect(first.ok).toBe(true);

    const second = await createSubscription(ctx, {
      memberId: memberB,
      planId: planB,
    });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toMatch(
      /already has an active subscription/i,
    );
  }, 60_000);
});
