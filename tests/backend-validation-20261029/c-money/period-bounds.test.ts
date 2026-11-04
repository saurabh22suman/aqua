// @vitest-environment node
//
// Lane c-money — the owner reports' period is the TENANT's calendar
// days, not UTC days (F-13).
//
// The money layer already worked this way: lib/services/fees-hub.ts and
// lib/services/owner-analytics.ts bound a period with dayRangeUtc
// (00:00 in the tenant's zone to 00:00 the next day), and
// lib/services/owner-insights-period.ts documents the hazard in
// words — "a window that starts at 00:00 IST is 18:30 UTC the previous
// day, and a UTC-day window would silently drop the club's first
// working hour".
//
// The enquiry funnel did not: it compared created_at with
// new Date('2026-10-01'), which is UTC midnight. The boundary case
// below is one enquiry created at 2026-10-01T19:00:00Z — that is
// 2026-10-02 00:30 IST, so it belongs to the SECOND day of the window
// and must not be counted in the first.
//
// The retention window is the same rule: the last 30 days are counted
// back from the tenant's today, not from the UTC date (which, between
// 00:00 and 05:30 IST, is still yesterday).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";
import { getEnquiryFunnel, getRetentionReport } from "@/lib/services/owner-reports";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

const tenantId: TenantId = asTenantId(uuidv7());
const locationA = uuidv7();
const personA = uuidv7();
const memberA = uuidv7();

const ctx = {
  tenantId,
  userId: asUserId(randomUUID()),
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["reports.operational", "reports.financial"]),
};

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Period Club', 'active', $3)",
    [tenantId, `period-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)",
    [locationA, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Period Member')",
    [personA, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', $6)",
    [
      memberA,
      tenantId,
      personA,
      locationA,
      `PERIOD-${RUN}`,
      // Joined exactly 30 tenant-local days ago: inside the 30-day
      // window, so the member is part of the eligible cohort.
      addDays(todayInZone(TZ), -30),
    ],
  );
  // One enquiry on the boundary instant: 2026-10-01T19:00:00Z is
  // 2026-10-02 00:30 IST, so it belongs to the second day.
  await admin.query(
    `insert into enquiries (id, tenant_id, full_name, source, stage, location_id, created_at)
     values ($1, $2, 'Boundary Enquiry', 'phone', 'new', $3, '2026-10-01T19:00:00Z')`,
    [uuidv7(), tenantId, locationA],
  );
}, 120_000);

afterAll(async () => {
  await admin.query("delete from enquiries where tenant_id = $1", [tenantId]);
  await admin.query("delete from members where tenant_id = $1", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.end();
}, 120_000);

describe("the owner report periods are the tenant's calendar days (F-13)", () => {
  it("files an enquiry at 00:30 IST on the second day of the window", async () => {
    const first = await getEnquiryFunnel(ctx, {
      from: "2026-10-01",
      to: "2026-10-02",
    });
    const firstTotal = first.reduce((sum, row) => sum + row.total, 0);
    expect(firstTotal).toBe(0);

    const second = await getEnquiryFunnel(ctx, {
      from: "2026-10-02",
      to: "2026-10-03",
    });
    const secondTotal = second.reduce((sum, row) => sum + row.total, 0);
    expect(secondTotal).toBe(1);
  }, 60_000);

  it("counts the retention window back from the tenant's today", async () => {
    const report = await getRetentionReport(ctx);
    // The member joined exactly 30 tenant-local days ago, so they are
    // inside the window and inside the eligible cohort.
    expect(report.eligibleMemberCount).toBe(1);
    expect(report.row.totalActiveMembers).toBe(1);
  }, 60_000);
});
