import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  dashboard: vi.fn(),
  charts: vi.fn(),
  facilities: vi.fn(),
  comparison: vi.fn(),
  build: vi.fn(),
  branding: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.ctx }));
vi.mock("@/lib/services/dashboard", () => ({ getOwnerDashboard: mocks.dashboard }));
vi.mock("@/lib/services/owner-home-charts", () => ({ getOwnerCharts: mocks.charts }));
vi.mock("@/lib/services/owner-home-brief", () => ({
  listOwnerBriefFacilities: mocks.facilities,
  getOwnerHomeFacilityMoney: mocks.comparison,
  buildOwnerHomeBriefView: mocks.build,
}));
vi.mock("@/lib/services/branding", () => ({ getBranding: mocks.branding }));

import { getOwnerHomeBriefAction, getOwnerHomeFacilityMoneyAction } from "@/lib/actions/owner-home-brief";

const allowed = "0196b0c0-0100-7000-8000-000000000001";
const foreign = "0196b0c0-0100-7000-8000-000000000002";
const permissions = new Set(["dashboard.view", "reports.financial", "invoices.read"]);
const owner = { roleKey: "owner", permissions, features: new Set(["reports", "billing"]) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ctx.mockResolvedValue(owner);
  mocks.charts.mockResolvedValue(null);
  mocks.facilities.mockResolvedValue([{ id: allowed, name: "North" }]);
});

describe("Owner brief action boundary", () => {
  it.each(["admin", "manager", "accountant", "coach"])("denies the %s role before service reads", async roleKey => {
    mocks.ctx.mockResolvedValue({ ...owner, roleKey });
    await expect(getOwnerHomeBriefAction()).rejects.toThrow();
    await expect(getOwnerHomeFacilityMoneyAction()).rejects.toThrow();
    expect(mocks.facilities).not.toHaveBeenCalled();
    expect(mocks.comparison).not.toHaveBeenCalled();
  });

  it("rejects an unavailable UUID before either scoped dashboard read", async () => {
    await expect(getOwnerHomeBriefAction({ facility: foreign })).rejects.toThrow();
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.charts).not.toHaveBeenCalled();
  });

  it("reuses the entitled action's exact facility in both reads", async () => {
    await getOwnerHomeBriefAction({ facility: allowed });
    expect(mocks.dashboard).toHaveBeenCalledWith(owner, { locationId: allowed });
    expect(mocks.charts).toHaveBeenCalledWith(owner, { period: "last7", locationId: allowed });
  });

  it("requires billing to aggregate site money and to read charts", async () => {
    mocks.ctx.mockResolvedValue({ ...owner, features: new Set(["reports"]) });
    await expect(getOwnerHomeFacilityMoneyAction()).rejects.toThrow();
    await getOwnerHomeBriefAction();
    expect(mocks.charts).not.toHaveBeenCalled();
    expect(mocks.comparison).not.toHaveBeenCalled();
  });
});
