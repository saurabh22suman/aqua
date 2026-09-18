// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// U-01 — the analytics cards render real inline SVG when data exists
// and an honest empty state when it does not. No chart dependency:
// the assertions look for the SVG primitives, not a library root.

import {
  AttendanceTrendCard,
  CollectionsExpensesCard,
  MemberMixCard,
  PlanRevenueCard,
} from "@/components/reports/analytics-cards";

afterEach(cleanup);

describe("U-01 attendance trend", () => {
  it("draws a line when sessions exist", () => {
    render(
      <AttendanceTrendCard
        points={[
          { date: "2026-09-01", present: 12, total: 16, pct: 75 },
          { date: "2026-09-02", present: 14, total: 16, pct: 88 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /attendance percentage by day/i })).toBeTruthy();
    expect(document.querySelectorAll("path.stroke-water").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/present/i);
  });

  it("says so when the period has no sessions", () => {
    render(<AttendanceTrendCard points={[]} />);
    expect(document.body.textContent).toMatch(/no sessions in this period/i);
    expect(document.querySelector("svg")).toBeNull();
  });
});

describe("U-01 collections vs expenses", () => {
  it("draws collections and names expenses as untracked", () => {
    render(
      <CollectionsExpensesCard
        series={{
          totalPaise: 125_000,
          byDay: [
            { date: "2026-09-01", paise: 50_000 },
            { date: "2026-09-02", paise: 75_000 },
          ],
          expensesPaise: null,
        }}
      />,
    );
    expect(screen.getByRole("img", { name: /collections by day/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/expenses — not recorded in aqua yet/i);
    expect(document.body.textContent).toMatch(/no target arc/i);
  });

  it("has an honest empty state when nothing was collected", () => {
    render(
      <CollectionsExpensesCard
        series={{ totalPaise: 0, byDay: [], expensesPaise: null }}
      />,
    );
    expect(document.body.textContent).toMatch(/no payments recorded in this period/i);
    expect(document.querySelector("svg")).toBeNull();
  });
});

describe("U-01 plan-wise revenue", () => {
  it("renders horizontal bars per plan", () => {
    render(
      <PlanRevenueCard
        rows={[
          { planName: "Monthly", paise: 200_000, paymentCount: 4 },
          { planName: "Term", paise: 500_000, paymentCount: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /collections by membership plan/i })).toBeTruthy();
    expect(document.body.textContent).toContain("Monthly");
    expect(document.body.textContent).toContain("Term");
  });

  it("says so when no payment links to a plan", () => {
    render(<PlanRevenueCard rows={[]} />);
    expect(document.body.textContent).toMatch(/no payments linked to a plan/i);
  });
});

describe("U-01 member mix", () => {
  it("renders a donut and legend with real counts", () => {
    render(
      <MemberMixCard
        memberLabel="Members"
        slices={[
          { status: "active", count: 30 },
          { status: "paused", count: 4 },
          { status: "left", count: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /members mix by status/i })).toBeTruthy();
    expect(document.body.textContent).toContain("Active");
    expect(document.body.textContent).toContain("30");
    expect(document.body.textContent).toContain("Paused");
  });

  it("has an honest empty state with no members", () => {
    render(<MemberMixCard memberLabel="Members" slices={[]} />);
    expect(document.body.textContent).toMatch(/no members records yet/i);
  });
});
