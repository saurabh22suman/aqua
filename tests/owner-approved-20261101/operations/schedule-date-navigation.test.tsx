// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";

afterEach(cleanup);

function setup() {
  render(<OwnerScheduleGrid view="agenda" anchor="2026-11-01" locationId="loc-1"
    locations={[{ id: "loc-1", name: "Main" }, { id: "loc-2", name: "North" }]}
    sessions={[]} days={["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]}
    monthCells={null} prevHref="/owner/schedule?view=agenda&date=2026-10-25&location=loc-1"
    nextHref="/owner/schedule?view=agenda&date=2026-11-08&location=loc-1"
    todayHref="/owner/schedule?view=agenda&date=2026-11-01&location=loc-1" />);
}

it("chooses a date and keeps the current agenda and facility in the URL", () => {
  setup();
  const submitted: URL[] = [];
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const url = new URL(form.action);
    url.search = new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();
    submitted.push(url);
  };
  document.addEventListener("submit", onSubmit, { once: true });
  fireEvent.click(screen.getByRole("button", { name: /choose date/i }));
  fireEvent.click(screen.getByRole("button", { name: "15 November 2026" }));
  expect(submitted).toHaveLength(1);
  const url = submitted[0]!;
  expect(url.pathname).toBe("/owner/schedule");
  expect(Object.fromEntries(url.searchParams)).toEqual({ view: "agenda", date: "2026-11-15", location: "loc-1" });
});

it("dismisses the calendar without navigating", () => {
  setup();
  const submitted = vi.fn((event: Event) => event.preventDefault());
  document.addEventListener("submit", submitted, { once: true });
  fireEvent.click(screen.getByRole("button", { name: /choose date/i }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: /choose a date/i }), { key: "Escape" });
  expect(submitted).not.toHaveBeenCalled();
  document.removeEventListener("submit", submitted);
});
