// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/locations", () => ({ createLocationAction: vi.fn(), listAdminLocationsAction: vi.fn(), updateLocationAction: vi.fn(), getBusinessHoursAction: vi.fn(async () => ({days:[]})), setBusinessHoursAction: vi.fn() }));
import { LocationManager } from "@/components/settings/location-manager";
afterEach(cleanup);
it("keeps site details in individually labelled disclosures and preserves a draft", () => {
  const row = {id:"a",name:"North",kind:"club" as const,isPrimary:true,address:{city:"Pune"},createdAt:"2026-01-01"};
  render(<LocationManager initial={[row,{...row,id:"b",name:"South",isPrimary:false}]} canWrite />);
  const north = screen.getByText("North").closest("summary")!;
  const south = screen.getByText("South").closest("summary")!;
  expect(north.closest("details")?.open).toBe(false);
  expect(south.closest("details")?.open).toBe(false);
  fireEvent.click(north);
  const section = north.closest("details")!;
  const name = within(section).getByLabelText("Name") as HTMLInputElement;
  fireEvent.change(name,{target:{value:"North draft"}});
  fireEvent.click(north); fireEvent.click(north);
  expect((within(section).getByLabelText("Name") as HTMLInputElement).value).toBe("North draft");
  expect(south.closest("details")?.open).toBe(false);
});
