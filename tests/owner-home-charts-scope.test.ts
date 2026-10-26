import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import { listHubTransactions } from "@/lib/services/fees-hub";
import { createMember } from "@/lib/services/register";
import { addDays, todayInZone } from "@/lib/time/tz";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { privilegedFixturePool as admin } from "./db/privileged-fixture";

// Owner Home chart aggregation, end to end against the disposable test DB:
// the facility scope can only narrow, the periods reconcile with the
// recorded transactions, the method groups match the doughnut, and the
// Home category drill-down lands on the same filtered rows.

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let locationA = "";
let locationB = "";
let memberA = "";
let memberB = "";

const owner = {
  userId: asUserId(randomUUID()),
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
};

const restrictedA = {
  userId: asUserId(randomUUID()),
  roleKey: "admin",
  allLocations: false,
  locationIds: [] as string[],
  permissions: new Set(["dashboard.view", "reports.financial", "payments.read"]),
};

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Chart Scope', $3)",
    [tenantId, `chart-scope-${RUN}`, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .insert(locations)
      .values([
        { tenantId, name: "Chart A", isPrimary: true },
        { tenantId, name: "Chart B", isPrimary: false },
      ])
      .returning({ id: locations.id });
    locationA = rows[0]!.id;
    locationB = rows[1]!.id;
  });
  const a = await createMember(
    { tenantId },
    {
      fullName: "Chart Member A",
      dateOfBirth: "1990-01-01",
      locationId: locationA,
      memberCode: `CHART-A-${RUN}`,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } },
      ],
    },
  );
  if (!a.ok) throw new Error(a.error);
  memberA = a.memberId;
  const b = await createMember(
    { tenantId },
    {
      fullName: "Chart Member B",
      dateOfBirth: "1990-01-01",
      locationId: locationB,
      memberCode: `CHART-B-${RUN}`,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } },
      ],
    },
  );
  if (!b.ok) throw new Error(b.error);
  memberB = b.memberId;

  const today = todayInZone(TZ);
  const makeInvoice = async (locationId: string, memberId: string, suffix: string) => {
    const id = uuidv7();
    await admin.query(
      `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
         financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
         paid_paise, status)
       values ($1,$2,$3,$4,$5,'2026-27',$6,$7,100000,0,100000,40000,'partial')`,
      [id, tenantId, locationId, memberId, `CHART-${RUN}-${suffix}`, addDays(today, -10), addDays(today, -5)],
    );
    return id;
  };
  const invoiceA = await makeInvoice(locationA, memberA, "A");
  const invoiceB = await makeInvoice(locationB, memberB, "B");

  const receivedAt = new Date(Date.now() - 60 * 60 * 1000);
  await admin.query(
    `insert into payments (id, tenant_id, invoice_id, member_id, location_id,
       amount_paise, method, received_at, status)
     values ($1,$2,$3,$4,$5,60000,'cash',$6,'captured'),
            ($7,$2,$8,$9,$10,40000,'upi',$6,'captured')`,
    [
      uuidv7(),
      tenantId,
      invoiceA,
      memberA,
      locationA,
      receivedAt,
      uuidv7(),
      invoiceB,
      memberB,
      locationB,
    ],
  );

  // Location-scoped staff: only the explicit list is visible.
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );
  restrictedA.locationIds = [locationA];
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from payments where tenant_id = $1", [tenantId]);
    await admin.query("delete from invoices where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from config_values where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("owner Home charts — aggregation and scope", () => {
  it("totals captured payments and groups them cash / digital / other", async () => {
    const data = await getOwnerCharts({ tenantId, ...owner }, { period: "day" });
    expect(data.collections.totalPaise).toBe(100000);
    expect(data.collections.paymentCount).toBe(2);
    const groups = Object.fromEntries(data.collections.groups.map((g) => [g.key, g.paise]));
    expect(groups).toEqual({ cash: 60000, digital: 40000, other: 0 });
    // Previous day had no payments: no growth figure is invented.
    expect(data.collections.previousIsZero).toBe(true);
    expect(data.collections.comparison).toBe(
      "No previous collections in the comparison range",
    );
  }, 60_000);

  it("narrows to the caller's locations and cannot be widened by the URL", async () => {
    const scoped = await getOwnerCharts(
      { tenantId, ...restrictedA },
      { period: "day" },
    );
    expect(scoped.collections.totalPaise).toBe(60000);
    expect(scoped.collections.groups.find((g) => g.key === "digital")?.paise).toBe(0);

    // Asking for B while only A is allowed returns nothing, never B's money.
    const widened = await getOwnerCharts(
      { tenantId, ...restrictedA },
      { period: "day", locationId: locationB },
    );
    expect(widened.collections.totalPaise).toBe(0);
  }, 60_000);

  it("drills into exactly the filtered transactions behind a group total", async () => {
    const today = todayInZone(TZ);
    const digital = await listHubTransactions(
      { tenantId, ...owner },
      { from: today, to: addDays(today, 1), group: "digital" },
    );
    expect(digital).toHaveLength(1);
    expect(digital[0]!.method).toBe("upi");
    expect(digital[0]!.amountPaise).toBe(40000);

    const scopedDigital = await listHubTransactions(
      { tenantId, ...restrictedA },
      { from: today, to: addDays(today, 1), group: "digital" },
    );
    expect(scopedDigital).toHaveLength(0);
  }, 60_000);

  it("reads attendance as unknown when a period has no marks", async () => {
    const data = await getOwnerCharts({ tenantId, ...owner }, { period: "day" });
    expect(data.attendance.total).toBe(0);
    expect(data.attendance.pct).toBeNull();
    expect(data.attendance.buckets.every((bucket) => bucket.pct === null)).toBe(true);
  }, 60_000);
});
