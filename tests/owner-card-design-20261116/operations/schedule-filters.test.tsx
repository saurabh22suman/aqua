// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";
afterEach(cleanup);
it("starts secondary schedule filters collapsed while keeping the selected view and location available", () => {
  render(<OwnerScheduleGrid view="week" anchor="2026-11-17" locationId="north" locations={[{ id: "north", name: "North" }, { id: "south", name: "South" }]} sessions={[]} days={["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]} monthCells={null} prevHref="#prev" nextHref="#next" todayHref="#today" dayHref="#day" weekHref="#week" monthHref="#month" agendaHref="#agenda" />);
  const summary = screen.getByText("Filters");
  expect(screen.getByText("Club: North")).toBeTruthy();
  const details = summary.closest("details");
  expect(details?.open).toBe(false);
  fireEvent.click(summary);
  expect(details?.open).toBe(true);
  expect(within(details!).getByRole("combobox", { name: "Location" })).toHaveProperty("value", "north");
  expect(within(details!).getByRole("link", { name: "Agenda" }).getAttribute("href")).toBe("#agenda");
});
