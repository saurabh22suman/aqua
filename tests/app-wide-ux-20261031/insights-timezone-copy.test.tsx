// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OwnerInsightsHome } from "@/components/owner-insights-home/owner-insights-home";

afterEach(cleanup);

it("shows the included insight dates without a timezone suffix", () => {
  render(<OwnerInsightsHome data={{ from: "2026-10-02", to: "2026-11-01", timezone: "Asia/Kolkata", enquiries: null }} />);
  const section = screen.getByRole("region", { name: "Insights" });
  expect(section.textContent).toContain("2 Oct 2026");
  expect(section.textContent).toContain("31 Oct 2026");
  expect(section.textContent).not.toMatch(/Asia\/(Kolkata|Calcutta)|\bIST\b/);
});

it.each([
  ["2026-09-27", "2026-10-27", "27 Sept 2026", "26 Oct 2026"],
  ["2026-12-20", "2027-01-03", "20 Dec 2026", "2 Jan 2027"],
])("keeps included dates across month or year boundaries", (from, to, first, last) => {
  render(<OwnerInsightsHome data={{ from, to, timezone: "Asia/Kolkata", enquiries: null }} />);
  const text = screen.getByRole("region", { name: "Insights" }).textContent ?? "";
  expect(text).toContain(first);
  expect(text).toContain(last);
  expect(text).not.toMatch(/Asia\/(Kolkata|Calcutta)|\bIST\b/);
});
