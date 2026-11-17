// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const empty = {rows:[],loading:false,failed:false,error:null,retry:vi.fn()};
vi.mock("@/components/booking-reads", () => ({useBookingDayRead:() => empty,useBookingWeekRead:() => empty,BookingReadError:() => null}));
vi.mock("@/components/bookings/use-booking-entry-pass-view", () => ({useBookingEntryPassView:() => ({})}));
vi.mock("@/lib/actions/bookings", () => ({cancelBookingAction:vi.fn(),requestBookingBillAction:vi.fn()}));
vi.mock("@/components/booking-form", () => ({BookingForm:({facilityId,date,slotStart}:{facilityId:string;date:string;slotStart:string}) => <><p>Form resource {facilityId}</p><p>Selected {date} {slotStart}</p></>}));
vi.mock("@/components/owner-calendar/owner-calendar", () => ({OwnerCalendar:() => null}));
vi.mock("@/components/owner-calendar/owner-calendar-toolbar", () => ({OwnerCalendarToolbar:() => null}));
import { BookingScreen } from "@/components/booking-screen";
import type { BookableFacility } from "@/lib/services/bookings";
afterEach(cleanup);
it("lets the operator change the board resource without losing the booking form context", () => {
  const facilities: BookableFacility[] = [{id:"a",name:"Court A",kind:"court",capacity:4,locationId:"site-a",locationName:"Site A",subUnits:[]},{id:"b",name:"Court B",kind:"court",capacity:4,locationId:"site-a",locationName:"Site A",subUnits:[]}];
  render(<BookingScreen facilities={facilities} timezone="Asia/Kolkata" today="2026-11-13" terminology={{overrides:{},locale:"en"}} canCreate />);
  fireEvent.change(screen.getByLabelText("Board resource"),{target:{value:"b"}});
  expect(screen.getByText("Form resource b")).toBeTruthy();
});
it("restores the selected resource, date and slot supplied after price setup", () => {
  const facilities:BookableFacility[] = [{id:"a",name:"Court A",kind:"court",capacity:4,locationId:"site-a",locationName:"Site A",subUnits:[]},{id:"b",name:"Court B",kind:"court",capacity:4,locationId:"site-a",locationName:"Site A",subUnits:[]}];
  render(<BookingScreen facilities={facilities} timezone="Asia/Kolkata" today="2026-11-13" terminology={{overrides:{},locale:"en"}} canCreate initialResource="b" initialDate="2026-11-15" initialSlot="10:00" />);
  expect(screen.getByText("Form resource b")).toBeTruthy();
  expect(screen.getByText("Selected 2026-11-15 10:00")).toBeTruthy();
});
