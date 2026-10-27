// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — the Fees overview.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
//   1. The overview mixed one hand-rolled "collected" card with two
//      summary tiles, so the period figure did not sit in the same
//      row as the current balances and the reader could not scan the
//      four figures the approved direction shows.
//   2. The period figure and the current balances were not separated
//      by their labels: a historical collection sat next to a live
//      balance without saying which was which.
//   3. There was no single action leading into the invoice collection
//      journey — the reader had to find the Dues tab themselves.
//
// The approved preview: "Period collections and current balances use
// different labels", four figures, and "One action leads into the
// invoice collection journey."

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
  it("states four figures in one row, each with its basis", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const cards = screen.getAllByTestId("stat-card");
    expect(cards).toHaveLength(4);

    const labels = cards.map((card) => card.textContent ?? "");
    expect(labels.join(" ")).toMatch(/in this period/i);
    expect(labels.join(" ")).toMatch(/outstanding now/i);
    expect(labels.join(" ")).toMatch(/overdue now/i);
    expect(labels.join(" ")).toMatch(/payments in this period/i);
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
