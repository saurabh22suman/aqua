import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { asTenantId } from "@/lib/ids";
const calls = vi.hoisted(() => ({ daily: vi.fn(), fees: vi.fn(), cash: vi.fn() }));
vi.mock("@/lib/services/reconciliation", () => ({ getDailyCollection: calls.daily }));
vi.mock("@/lib/services/fees-hub", () => ({ getFeesOverview: calls.fees }));
vi.mock("@/lib/services/reconciliation-closed-state", () => ({ listCashCountsNeedingReview: calls.cash }));
import { getOwnerDashboard } from "@/lib/services/dashboard";
const tenantId = asTenantId(randomUUID());
beforeAll(async () => { await admin.query("insert into tenants(id,slug,name,status,timezone) values($1,$2,'Finance boundary fixture','active','Asia/Kolkata')", [tenantId, `finance-boundary-${tenantId}`]); });
afterAll(async () => { await admin.query("delete from tenants where id=$1", [tenantId]); await admin.end(); });
beforeEach(() => {
  vi.clearAllMocks();
  calls.daily.mockResolvedValue({ totalPaise: 2100000, paymentCount: 2 });
  calls.fees.mockResolvedValue({ outstandingPaise: 420000, dueInvoiceCount: 1, overduePaise: 420000, overdueInvoiceCount: 1 });
  calls.cash.mockResolvedValue([{ locationName: "Court A", onDate: "2026-10-31", variancePaise: 60000 }]);
});
describe("dashboard financial authorization", () => {
  it.each([["dashboard.view"], ["dashboard.view", "reports.financial"], ["dashboard.view", "invoices.read"]])("does not read or expose financial data without both grants: %s", async (...permissions) => {
    const result = await getOwnerDashboard({ tenantId, allLocations: true, permissions: new Set(permissions) });
    expect(calls.daily).not.toHaveBeenCalled(); expect(calls.fees).not.toHaveBeenCalled(); expect(calls.cash).not.toHaveBeenCalled();
    expect(result.money).toBeNull();
    expect(result.needsAttention.map(x => x.title)).not.toContain("Cash count needs review");
    expect(result.needsAttention.map(x => x.title)).not.toContain("Overdue fees");
    expect(result.tenantName).toBe("Finance boundary fixture");
  });
  it("retains real financial values and attention for both grants", async () => {
    const result = await getOwnerDashboard({ tenantId, allLocations: true, permissions: new Set(["dashboard.view", "reports.financial", "invoices.read"]) });
    expect(calls.daily).toHaveBeenCalledOnce(); expect(calls.fees).toHaveBeenCalledOnce(); expect(calls.cash).toHaveBeenCalledOnce();
    expect(result.money?.collectedTodayPaise).toBe(2100000);
    expect(result.money?.overduePaise).toBe(420000);
    expect(result.needsAttention.map(x => x.title)).toEqual(expect.arrayContaining(["Cash count needs review", "Overdue fees"]));
  });
});
