// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const reads = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/actions/bookings", () => ({ listBookingsAction: reads, quoteBookingAction: vi.fn(async () => ({ok:false,error:"No price"})), createBookingAction: vi.fn(), cancelBookingAction: vi.fn(), requestBookingBillAction: vi.fn() }));
vi.mock("@/components/cafe-member-picker", () => ({ CafeMemberPicker: () => null }));
import { BookingScreen } from "@/components/booking-screen";
const resource = (id:string) => ({id,name:`Court ${id}`,kind:"court" as const,capacity:4,locationId:`loc-${id}`,locationName:"Site",subUnits:[]});
afterEach(() => { cleanup(); reads.mockClear(); });
it("updates the resource read when authorized location scope changes", async () => {
 const props = { timezone: "Asia/Kolkata", today: "2026-11-01", terminology: {locale:"en" as const, overrides:{}} };
 const view = render(<BookingScreen {...props} facilities={[resource("a")]} />);
 await waitFor(() => expect(reads).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "a" })));
 view.rerender(<BookingScreen {...props} facilities={[resource("b")]} />);
 await waitFor(() => expect(reads).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "b" })));
 expect(screen.getByTestId("booking-slot-summary").textContent).toContain("Court b");
});
