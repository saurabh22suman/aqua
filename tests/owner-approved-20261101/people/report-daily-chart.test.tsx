// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DailyChart, daysBetween } from "@/components/reports/owner-people/report-shared";

afterEach(cleanup);
const days = daysBetween("2026-10-26", "2026-11-01");

it("uses a concise empty message without a zero-only plot, keeping exact data accessible", () => {
  render(<DailyChart title="Recorded check-ins by day" emptyMessage="No recorded check-ins in this range." days={days} values={new Map()} />);
  expect(screen.getByText("No recorded check-ins in this range.")).toBeTruthy();
  expect(screen.queryByRole("img", { name: "Recorded check-ins by day" })).toBeNull();
  const details = screen.getByText("View data").closest("details");
  expect(details).toBeTruthy();
  expect(within(details!).getByText("26 Oct 2026")).toBeTruthy();
  expect(details?.querySelectorAll("tbody tr")).toHaveLength(7);
});

it.each([7, 31])("renders short date ticks and keeps exact dates and real counts for %i days", (length) => {
  const dates = daysBetween("2026-10-01", length === 7 ? "2026-10-07" : "2026-10-31");
  render(<DailyChart title="Shifts by day" emptyMessage="No shifts in this range." days={dates} values={new Map([["2026-10-01", 3]])} />);
  const chart = screen.getByRole("img", { name: "Shifts by day" });
  const tickLabels = Array.from(chart.querySelectorAll("text")).map((node) => node.textContent ?? "");
  expect(tickLabels.some((label) => /1 Oct$/.test(label))).toBe(true);
  expect(tickLabels.some((label) => /2026/.test(label))).toBe(false);
  const table = document.querySelector<HTMLTableElement>("details table")!;
  expect(within(table).getByText("1 Oct 2026")).toBeTruthy();
  expect(within(table).getByText("3")).toBeTruthy();
  expect(table.querySelectorAll("tbody tr")).toHaveLength(length);
});
