// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";

afterEach(cleanup);

it("offers a named date picker alongside the schedule view and navigation", () => {
  render(<OwnerScheduleGrid
    view="day" anchor="2026-11-01" days={["2026-11-01"]}
    locations={[]} sessions={[]} monthCells={null}
    prevHref="/owner/schedule?view=day&date=2026-10-31"
    todayHref="/owner/schedule?view=day&date=2026-11-01"
    nextHref="/owner/schedule?view=day&date=2026-11-02"
    dayHref="/owner/schedule?view=day&date=2026-11-01"
    weekHref="/owner/schedule?view=week&date=2026-11-01"
    agendaHref="/owner/schedule?view=agenda&date=2026-11-01"
  />);
  expect(screen.getByRole("button", { name: /choose date/i })).toBeTruthy();
  expect(screen.getByRole("link", { name: /previous day/i })).toBeTruthy();
  expect(screen.getByRole("link", { name: /week/i })).toBeTruthy();
});
