// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock("@/lib/actions/holidays", () => ({addHolidayAction: vi.fn(), removeHolidayAction: vi.fn()}));
import { HolidaysBoard } from "@/components/holidays-board";
afterEach(cleanup);
it("states club-wide closure scope and offers an explicit review of existing sessions", () => {
  render(<HolidaysBoard initialHolidays={[{id:"h1",name:"Closure",holidayDate:"2026-12-01",recurringYearly:true}]} reviews={{h1:{holidayId:"h1",through:"2027-01-01",truncated:false,sessions:[{id:"s1",batchName:"Batch",date:"2026-12-01",locationId:"a",locationName:"Site A",status:"scheduled"}]}}} />);
  expect(screen.getByText(/club-wide/i)).toBeTruthy();
  expect(screen.getByRole("link",{name:/review.*sessions/i})).toBeTruthy();
});
it("keeps a bounded multi-site preview until the user expands it, and explains its limits", () => {
  const sessions = Array.from({length: 8}, (_, i) => ({id:`s${i}`,batchName:`Long batch name ${i} ${"word ".repeat(20)}`,date:"2026-12-01",locationId:i % 2 ? "b" : "a",locationName:i % 2 ? "Site B" : "Site A",status:"scheduled"}));
  render(<HolidaysBoard initialHolidays={[{id:"h1",name:"Long closure name ".repeat(10),holidayDate:"2026-12-01",recurringYearly:true}]} reviews={{h1:{holidayId:"h1",through:"2027-01-01",truncated:true,sessions}}} />);
  expect(screen.getByText(/at least 8 affected sessions/i)).toBeTruthy();
  expect(screen.getByText(/366 days/i)).toBeTruthy();
  expect(screen.getByText(/additional sessions.*not shown/i)).toBeTruthy();
  expect(screen.queryByText(/Long batch name 7/)).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:/show.*affected sessions/i}));
  expect(screen.getByText(/Long batch name 7/)).toBeTruthy();
  expect(screen.getAllByText(/Site B/).length).toBeGreaterThan(0);
});
it("uses sport-neutral empty-state language", () => {
  render(<HolidaysBoard initialHolidays={[]} />);
  expect(screen.queryByText(/pool/i)).toBeNull();
});
