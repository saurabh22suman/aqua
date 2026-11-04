// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BatchReport } from "@/components/reports/owner-batches/batch-report";

afterEach(cleanup);
const row = {batchId:"b",batchName:"Morning",programName:"Swimming",locationId:"l",locationName:"Main",capacity:3,reservedPlaces:4};
it("shows exact current reserved places including overcapacity", () => {
  render(<BatchReport rows={[row]} canViewFinancial={false} />);
  expect(screen.getByText("Morning")).toBeTruthy();
  expect(screen.getByText(/4 of 3/)).toBeTruthy();
  expect(screen.getByText(/over capacity/i)).toBeTruthy();
  expect(screen.queryByText(/collections by batch/i)).toBeNull();
});
it("does not invent batch income, and offers a financial report only to authorized readers", () => {
  render(<BatchReport rows={[]} canViewFinancial />);
  expect(screen.getByText(/no batches/i)).toBeTruthy();
  expect(screen.getByText(/collections by batch are unavailable/i)).toBeTruthy();
  expect(screen.getByRole("link", {name:/daily collections/i}).getAttribute("href")).toBe("/owner/reports/collections");
});
