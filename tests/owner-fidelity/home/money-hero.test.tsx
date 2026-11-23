// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { OwnerHomeMoney } from "@/components/owner-home/owner-home-money";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

afterEach(cleanup);
const money: NonNullable<OwnerDashboardData["money"]> = {
  collectedTodayPaise: 1840000, collectedTodayCount: 5,
  outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0,
  overdueInvoiceCount: 0, oldestOverdueDays: null,
};

it("shows today's real collection and count with scoped payment actions, not a duplicate trend", () => {
  render(<OwnerHomeMoney money={money} collectedHref="/owner/fees?tab=payments&facility=north" collectHref="/owner/fees?tab=dues&facility=north" last7Paise={999900} trendHref="/owner/reports/collections" rangeLabel="Last 7 days" />);
  const hero = within(screen.getByTestId("owner-home-money-surface"));
  expect(hero.getByText("Collected today")).toBeTruthy();
  expect(hero.getByText("₹18,400")).toBeTruthy();
  expect(hero.getByText("5 payments recorded")).toBeTruthy();
  expect(hero.getByRole("link", { name: /view payments/i }).getAttribute("href")).toBe("/owner/fees?tab=payments&facility=north");
  expect(hero.getByRole("link", { name: /record payment/i }).getAttribute("href")).toBe("/owner/fees?tab=dues&facility=north");
  expect(hero.queryByText("Last 7 days")).toBeNull();
  expect(hero.queryByRole("link", { name: /view trend/i })).toBeNull();
});

it("represents a real zero and withholds actions without authorized destinations", () => {
  render(<OwnerHomeMoney money={{ ...money, collectedTodayPaise: 0, collectedTodayCount: 0 }} />);
  expect(screen.getByText("₹0")).toBeTruthy();
  expect(screen.getByText("0 payments recorded")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /view payments|record payment/i })).toBeNull();
});

it("uses the singular for one recorded payment and retains a long real amount", () => {
  render(<OwnerHomeMoney money={{ ...money, collectedTodayPaise: 123456789012, collectedTodayCount: 1 }} />);
  expect(screen.getByText("1 payment recorded")).toBeTruthy();
  expect(screen.getByText("₹1,23,45,67,890.12")).toBeTruthy();
});
