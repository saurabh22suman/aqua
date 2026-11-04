import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ctx: { permissions: new Set<string>(), features: new Set(["reports", "billing"]) },
  read: vi.fn(async () => ({ sentinel: "financial data" })),
}));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
vi.mock("@/lib/services/owner-home-charts", () => ({ getOwnerCharts: state.read }));
import { getOwnerChartsAction } from "@/lib/actions/owner-home-charts";

beforeEach(() => { state.read.mockClear(); state.ctx.features = new Set(["reports", "billing"]); });
it.each([
  ["reports.financial", ["dashboard.view", "invoices.read"]],
  ["invoices.read", ["dashboard.view", "reports.financial"]],
])("denies missing %s before reading the financial DTO", async (_missing, permissions) => {
  state.ctx.permissions = new Set(permissions);
  await expect(getOwnerChartsAction({ period: "last7" })).rejects.toThrow(/forbidden/i);
  expect(state.read).not.toHaveBeenCalled();
});
it("allows the existing grants and passes the authenticated scope", async () => {
  state.ctx.permissions = new Set(["dashboard.view", "reports.financial", "invoices.read"]);
  await getOwnerChartsAction({ period: "last7" });
  expect(state.read).toHaveBeenCalledWith(state.ctx, { period: "last7" });
});
it("rejects a disabled billing feature before reading", async () => {
  state.ctx.permissions = new Set(["dashboard.view", "reports.financial", "invoices.read"]);
  state.ctx.features.delete("billing");
  await expect(getOwnerChartsAction()).rejects.toThrow(/forbidden/i);
  expect(state.read).not.toHaveBeenCalled();
});
it("denies financial readers without dashboard access before calling the service", async () => {
  state.ctx.permissions = new Set(["reports.financial", "invoices.read"]);
  await expect(getOwnerChartsAction()).rejects.toThrow(/forbidden/i);
  expect(state.read).not.toHaveBeenCalled();
});
