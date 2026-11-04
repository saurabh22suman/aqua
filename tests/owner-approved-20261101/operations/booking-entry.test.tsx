// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/bookings", () => ({ listBookingsAction: vi.fn(async () => []), quoteBookingAction: vi.fn(async () => ({ ok: false, error: "Unpriced" })), createBookingAction: vi.fn(), cancelBookingAction: vi.fn(), requestBookingBillAction: vi.fn() }));
vi.mock("@/components/cafe-member-picker", () => ({ CafeMemberPicker: () => null }));
import { BookingScreen } from "@/components/booking-screen";
afterEach(cleanup);
it("offers a direct New booking link to the selected slot form", () => {
  render(<BookingScreen facilities={[{ id: "f1", name: "Court", kind: "court", capacity: 4, locationId: "l1", locationName: "Main", subUnits: [] }]} timezone="Asia/Kolkata" today="2026-11-01" terminology={{ locale: "en", overrides: {} }} canCreate={true} />);
  const entry = screen.getByRole("link", { name: /new booking/i });
  expect(entry.getAttribute("href")).toBe("#new-booking");
  expect(document.getElementById("new-booking")?.contains(screen.getByTestId("booking-create"))).toBe(true);
});
it("keeps native anchor navigation and reserves sticky chrome clearance for the form", () => {
  render(<BookingScreen facilities={[{ id: "f1", name: "Court", kind: "court", capacity: 4, locationId: "l1", locationName: "Main", subUnits: [] }]} timezone="Asia/Kolkata" today="2026-11-01" terminology={{ locale: "en", overrides: {} }} canCreate={true} />);
  const entry = screen.getByRole("link", { name: /new booking/i });
  const target = document.getElementById("new-booking")!;
  expect(entry.getAttribute("href")).toBe("#new-booking");
  expect(target.classList.contains("scroll-mt-[calc(var(--app-sticky-offset,0px)+5rem)]")).toBe(true);
  expect(fireEvent.click(entry)).toBe(true);
  expect(target.contains(screen.getByTestId("booking-create"))).toBe(true);
});
