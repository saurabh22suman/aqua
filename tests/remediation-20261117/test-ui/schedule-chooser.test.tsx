// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ScheduleMobileAgenda } from "@/components/owner-approved/operations/schedule-mobile-agenda";

afterEach(cleanup);
it("contains the visually hidden selection label inside its positioned day link", () => {
  render(<ScheduleMobileAgenda events={[]} days={["2026-11-16", "2026-11-17"]} selectedDate="2026-11-17" dayHrefs={{"2026-11-16": "/owner/schedule?view=week&date=2026-11-16&facility=site", "2026-11-17": "/owner/schedule?view=week&date=2026-11-17&facility=site"}} labels={{batch:"Batch",booking:"Booking"}} view="week" />);
  const chooser = screen.getByRole("navigation", {name:"Choose a day"});
  const selected = within(chooser).getByText("Selected");
  const link = selected.closest("a");
  expect(link?.classList.contains("relative")).toBe(true);
  expect(link?.getAttribute("aria-current")).toBe("date");
  expect(link?.getAttribute("href")).toContain("facility=site");
});
