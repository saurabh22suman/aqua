// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => ({}),requirePagePermission:vi.fn()}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({requireLiveOwnerSettingsPage:vi.fn()}));
vi.mock("@/lib/actions/activities", () => ({listActivitiesAction:async () => []}));
vi.mock("@/lib/actions/booking-price-admin", () => ({listBookingPriceRulesAction:async () => []}));
vi.mock("@/lib/actions/terminology", () => ({getTerminologyAction:async () => ({locale:"en",overrides:{}})}));
vi.mock("@/components/bookings/booking-price-manager", () => ({BookingPriceManager:() => null}));
import BookingPricesPage from "@/app/(owner)/owner/settings/booking-prices/page";
afterEach(cleanup);
it("returns to the selected booking slot, not an arbitrary redirect", async () => {
  render(await BookingPricesPage({searchParams:Promise.resolve({resource:"r1",facility:"site-a",date:"2026-11-15",slot:"10:00"})}));
  const href = screen.getByRole("link",{name:/return to selected booking slot/i}).getAttribute("href")!;
  const url = new URL(href,"http://localhost");
  expect(url.pathname).toBe("/owner/bookings");
  expect(Object.fromEntries(url.searchParams)).toEqual({resource:"r1",facility:"site-a",date:"2026-11-15",slot:"10:00"});
});
