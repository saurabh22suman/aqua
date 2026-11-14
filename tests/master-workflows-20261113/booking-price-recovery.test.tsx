// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/bookings", () => ({quoteBookingAction:async () => ({ok:false,error:"No price is configured for this slot."}),createBookingAction:vi.fn()}));
vi.mock("@/components/cafe-member-picker", () => ({CafeMemberPicker:() => null}));
import { BookingForm } from "@/components/booking-form";
import type { BookableFacility } from "@/lib/services/bookings";
const facility:BookableFacility = {id:"court-a",name:"Court A",kind:"court",capacity:4,locationId:"site-a",locationName:"Site A",subUnits:[]};
afterEach(cleanup);
it("offers authorized price setup for the selected slot without enabling booking", async () => {
  render(<BookingForm facilities={[facility]} timezone="Asia/Kolkata" today="2026-11-13" terminology={{overrides:{},locale:"en"}} facilityId="court-a" onFacilityChange={() => {}} date="2026-11-13" onDateChange={() => {}} onCreated={() => {}} slotStart="10:00" canManagePrices facilityScope="all" />);
  await screen.findByText("No price is configured for this slot.");
  const link = screen.getByRole("link",{name:/set.*price/i});
  expect(link.getAttribute("href")).toContain("resource=court-a");
  expect(link.getAttribute("href")).toContain("date=2026-11-13");
  expect(link.getAttribute("href")).toContain("slot=10%3A00");
  expect(link.getAttribute("href")).toContain("facility=all");
  expect((screen.getByTestId("booking-create") as HTMLButtonElement).disabled).toBe(true);
});
it("does not offer price settings to a user without the management grant", async () => {
  render(<BookingForm facilities={[facility]} timezone="Asia/Kolkata" today="2026-11-13" terminology={{overrides:{},locale:"en"}} facilityId="court-a" onFacilityChange={() => {}} date="2026-11-13" onDateChange={() => {}} onCreated={() => {}} slotStart="10:00" />);
  await screen.findByText("No price is configured for this slot.");
  expect(screen.queryByRole("link",{name:/set.*price/i})).toBeNull();
});
