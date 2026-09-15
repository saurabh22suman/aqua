// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR3 (ops console improvements) — Overview becomes a dashboard. This
// covers the four new sections against mocked data sources (the real
// queries are covered separately by tests/tenant-health-query-shape.test.ts
// and tests/platform-metrics-snapshot-job.test.ts against a real,
// disposable Postgres).

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    role: "operator",
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

const summaryMock = vi.fn();
const queueMock = vi.fn();
const activityMock = vi.fn();
vi.mock("@/db/platform-overview", () => ({
  getPlatformMetricsSummary: () => summaryMock(),
  getNeedsAttentionQueue: () => queueMock(),
}));
vi.mock("@/db/platform-activity", () => ({
  listPlatformActivity: () => activityMock(),
}));

import PlatformHome from "@/app/(platform)/ops/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FULL_SUMMARY = {
  activeTenants: { current: 128, previous: 120 },
  trialTenants: { current: 17, previous: 20 },
  atRiskTenants: { current: 6, previous: 6 },
  openOpsTasks: { current: 11, previous: 8 },
  asOf: new Date("2026-09-15T04:00:00.000Z"),
};

const QUEUE = [
  {
    tenantId: "t1",
    tenantName: "WaveRiders Academy",
    tenantSlug: "waveriders",
    text: "3 failed messages this week",
    severity: "attention" as const,
    ageDays: null,
  },
  {
    tenantId: "t2",
    tenantName: "Aqua Kids Pune",
    tenantSlug: "aqua-kids-pune",
    text: "Zero members",
    severity: "at_risk" as const,
    ageDays: null,
  },
];

const ACTIVITY = {
  rows: [
    {
      id: "a1",
      action: "tenant.activate",
      actorId: "u1",
      tenantId: "t1",
      tenantName: "Aqua Club Salt Lake",
      tenantSlug: "aqua-saltlake",
      detail: {},
      createdAt: new Date("2026-09-15T02:00:00.000Z"),
    },
  ],
  total: 1,
};

describe("Overview dashboard (PR3)", () => {
  it("renders KPI cards with deltas when a snapshot exists", async () => {
    summaryMock.mockResolvedValue(FULL_SUMMARY);
    queueMock.mockResolvedValue([]);
    activityMock.mockResolvedValue({ rows: [], total: 0 });

    render(await PlatformHome());

    expect(screen.getByText("128")).toBeDefined();
    expect(screen.getByText("17")).toBeDefined();
    expect(screen.getByText("6")).toBeDefined();
    expect(screen.getByText("11")).toBeDefined();
    // 128 - 120 = +8
    expect(screen.getByText(/\+8 from last month/)).toBeDefined();
    // 17 - 20 = -3
    expect(screen.getByText(/-3 from last month/)).toBeDefined();
    // 6 - 6 = 0
    expect(screen.getByText("No change from last month")).toBeDefined();
  });

  it("shows a no-snapshot-yet state instead of fabricated KPI numbers", async () => {
    summaryMock.mockResolvedValue({
      activeTenants: { current: 0, previous: null },
      trialTenants: { current: 0, previous: null },
      atRiskTenants: { current: 0, previous: null },
      openOpsTasks: { current: 0, previous: null },
      asOf: null,
    });
    queueMock.mockResolvedValue([]);
    activityMock.mockResolvedValue({ rows: [], total: 0 });

    render(await PlatformHome());

    expect(screen.getByText(/No metrics snapshot yet/)).toBeDefined();
    expect(screen.queryByText("Active tenants")).toBeNull();
  });

  it("renders the needs-attention queue as the primary element, sized larger than quick actions", async () => {
    summaryMock.mockResolvedValue(FULL_SUMMARY);
    queueMock.mockResolvedValue(QUEUE);
    activityMock.mockResolvedValue({ rows: [], total: 0 });

    const { container } = render(await PlatformHome());

    expect(screen.getByText("Needs attention")).toBeDefined();
    expect(screen.getByText("WaveRiders Academy")).toBeDefined();
    expect(screen.getByText("3 failed messages this week")).toBeDefined();
    expect(screen.getByText("Zero members")).toBeDefined();
    expect(screen.getByText("2 items")).toBeDefined();

    const viewLinks = screen.getAllByText("View");
    expect(viewLinks[0]?.closest("a")?.getAttribute("href")).toBe("/ops/tenants/t1");

    // Primary element gets the wider column.
    const attentionSection = screen.getByText("Needs attention").closest("section");
    expect(attentionSection?.className).toContain("lg:col-span-2");
    void container;
  });

  it("shows an empty state when the queue is clear", async () => {
    summaryMock.mockResolvedValue(FULL_SUMMARY);
    queueMock.mockResolvedValue([]);
    activityMock.mockResolvedValue({ rows: [], total: 0 });

    render(await PlatformHome());

    expect(screen.getByText("Nothing needs attention")).toBeDefined();
  });

  it("embeds recent activity with a link to the full log", async () => {
    summaryMock.mockResolvedValue(FULL_SUMMARY);
    queueMock.mockResolvedValue([]);
    activityMock.mockResolvedValue(ACTIVITY);

    render(await PlatformHome());

    const recent = screen.getByText("Recent activity").closest("section");
    if (!recent) throw new Error("recent activity section not found");
    expect(within(recent).getByText("tenant.activate")).toBeDefined();
    expect(within(recent).getByText(/Aqua Club Salt Lake/)).toBeDefined();
    const viewAll = within(recent).getByText("View all").closest("a");
    expect(viewAll?.getAttribute("href")).toBe("/ops/activity");
  });

  it("keeps the quick-actions launcher cards", async () => {
    summaryMock.mockResolvedValue(FULL_SUMMARY);
    queueMock.mockResolvedValue([]);
    activityMock.mockResolvedValue({ rows: [], total: 0 });

    render(await PlatformHome());

    const quickActions = screen.getByText("Quick actions").closest("section");
    if (!quickActions) throw new Error("quick actions section not found");
    expect(within(quickActions).getByText("Tenants").closest("a")?.getAttribute("href")).toBe(
      "/ops/tenants",
    );
    expect(within(quickActions).getByText("Feature catalogue")).toBeDefined();
    expect(within(quickActions).getByText("Presets")).toBeDefined();
    expect(within(quickActions).getByText("Leads")).toBeDefined();
  });
});
