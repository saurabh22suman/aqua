// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Period collections and current balances have distinct, truthful bases.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    roleKey: "owner",
    permissions: new Set(["reports.financial", "settings.manage"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: async () => [],
}));

vi.mock("@/lib/actions/fees-hub", () => ({
  getFeesOverviewAction: vi.fn(async () => OVERVIEW),
  listHubInvoicesAction: vi.fn(async () => []),
  listHubTransactionsAction: vi.fn(async () => []),
}));

import FeesPage from "@/app/(owner)/owner/fees/page";

const OVERVIEW = {
  from: "2026-10-01",
  to: "2026-10-31",
  collectedPaise: 1820000,
  paymentCount: 12,
  reversedPaise: 0,
  reversalCount: 0,
  outstandingPaise: 4280000,
  dueInvoiceCount: 4,
  overduePaise: 1260000,
  overdueInvoiceCount: 2,
  overdueAgeing: [],
  today: "2026-10-27",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("fees overview (C2)", () => {
  // Preserve exact-value and overdue-tone coverage at the Fees destination.
  it("formats actual outstanding and overdue values at their owner", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));
    const cards = screen.getAllByTestId("stat-card");
    const outstanding = cards.find(card => /outstanding now/i.test(card.textContent ?? ""));
    const overdue = cards.find(card => /overdue now/i.test(card.textContent ?? ""));
    expect(outstanding?.textContent).toContain("₹42,800.00");
    expect(overdue?.textContent).toContain("₹12,600.00");
    expect(overdue?.querySelector(".text-late")).toBeTruthy();
  });
  it("states period collections and current balances without a duplicate count KPI", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const cards = screen.getAllByTestId("stat-card");
    expect(cards).toHaveLength(3);

    const labels = cards.map((card) => card.textContent ?? "");
    expect(labels.join(" ")).toMatch(/in this period/i);
    expect(labels.join(" ")).toMatch(/outstanding now/i);
    expect(labels.join(" ")).toMatch(/overdue now/i);
    expect(labels.join(" ")).toMatch(/12 payments captured at the counter/i);
    expect(labels.join(" ")).not.toMatch(/payments in this period/i);
  });

  it("separates the period collections from the current balances", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const text = document.body.textContent ?? "";
    // The historical collection is named as a period figure…
    expect(text).toMatch(/collected in this period/i);
    // …and the current balances say "now".
    expect(text).toMatch(/outstanding now/i);
    expect(text).toMatch(/overdue now/i);
  });

  it("offers one action into the invoice collection journey", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const action = screen
      .getAllByRole("link")
      .find((link) => (link.getAttribute("href") ?? "").includes("tab=dues"));
    expect(action, "the overview leads into the dues journey").toBeTruthy();
    expect(action?.textContent ?? "").toMatch(/dues|due/i);
  });

  it("does not link the overdue figure to a list that does not select its cohort", async () => {
    // P3 (independent review) — the invoice list filters dues/all and
    // cannot select the overdue cohort, so a link from "Overdue now"
    // would show a balance that does not reconcile with the figure.
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const overdue = screen
      .getAllByTestId("stat-card")
      .find((card) => /overdue now/i.test(card.textContent ?? ""));
    expect(overdue, "the overdue figure is present").toBeTruthy();
    expect(
      overdue?.getAttribute("href"),
      "the overdue figure has no honest destination, so it is not a link",
    ).toBeNull();
  });
});
