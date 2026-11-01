// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ quote: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/actions/bookings", () => ({ quoteBookingAction: mocks.quote, createBookingAction: mocks.create }));
vi.mock("@/components/cafe-member-picker", () => ({ CafeMemberPicker: () => null }));
import { BookingForm } from "@/components/booking-form";

const facilities = ["Court A", "Court B"].map((name, i) => ({ id: `f-${i}`, name, kind: "court" as const, capacity: 4, locationId: "loc-1", locationName: "Main", subUnits: [] }));
const props = { facilities, timezone: "Asia/Kolkata", today: "2026-11-01", terminology: { locale: "en" as const, overrides: {} }, onFacilityChange: vi.fn(), date: "2026-11-01", onDateChange: vi.fn(), onCreated: vi.fn() };
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("does not show or allow confirming an old facility quote while the new quote is pending", async () => {
  mocks.quote.mockResolvedValueOnce({ ok: true, pricePaise: 50000 });
  let resolveQuote!: (value: { ok: false; error: string }) => void;
  mocks.quote.mockImplementationOnce(() => new Promise((resolve) => { resolveQuote = resolve; }));
  const view = render(<BookingForm {...props} facilityId="f-0" />);
  fireEvent.click(screen.getByTestId("booking-mode-walk-in"));
  fireEvent.change(screen.getByTestId("booking-walkin-name"), { target: { value: "Visitor" } });
  await waitFor(() => expect(screen.getByTestId("booking-quote").textContent).toContain("500"));
  expect((screen.getByTestId("booking-create") as HTMLButtonElement).disabled).toBe(false);
  view.rerender(<BookingForm {...props} facilityId="f-1" />);
  expect(screen.queryByTestId("booking-quote")?.textContent ?? "").not.toContain("500");
  expect((screen.getByTestId("booking-create") as HTMLButtonElement).disabled).toBe(true);
  resolveQuote({ ok: false, error: "No price configured" });
  await screen.findByText("No price configured");
  expect((screen.getByTestId("booking-create") as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("requires a fresh quote when returning to a previously selected facility", async () => {
  mocks.quote.mockResolvedValueOnce({ ok: true, pricePaise: 50000 });
  mocks.quote.mockImplementation(() => new Promise(() => {}));
  const view = render(<BookingForm {...props} facilityId="f-0" />);
  fireEvent.click(screen.getByTestId("booking-mode-walk-in"));
  fireEvent.change(screen.getByTestId("booking-walkin-name"), { target: { value: "Visitor" } });
  await screen.findByTestId("booking-quote");
  view.rerender(<BookingForm {...props} facilityId="f-1" />);
  view.rerender(<BookingForm {...props} facilityId="f-0" />);
  expect(screen.queryByTestId("booking-quote")).toBeNull();
  expect((screen.getByTestId("booking-create") as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.create).not.toHaveBeenCalled();
});
