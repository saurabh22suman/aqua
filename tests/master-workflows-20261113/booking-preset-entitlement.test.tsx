// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { BADMINTON_PRESET_DEFINITION } from "@/db/preset-definitions-r22";
const state = vi.hoisted(() => ({features:new Set<string>(),permissions:new Set(["bookings.read"])}));
vi.mock("next/navigation", () => ({notFound:() => {throw new Error("NOT_FOUND")}}));
vi.mock("next/headers", () => ({cookies:async () => ({get:() => undefined})}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => ({features:state.features,permissions:state.permissions}),requirePagePermission:(ctx:{permissions:Set<string>},permission:string) => { if (!ctx.permissions.has(permission)) throw new Error("DENIED"); }}));
vi.mock("@/lib/auth/permission", () => ({hasFeature:(ctx:{features:Set<string>},key:string) => ctx.features.has(key),hasPermission:() => false}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({isLiveOwnerForSettings:async () => false}));
vi.mock("@/lib/actions/bookings", () => ({listBookableFacilitiesAction:async () => []}));
vi.mock("@/lib/actions/booking-price-admin", () => ({getBookingPriceStatusAction:async () => ({active:0})}));
vi.mock("@/lib/actions/terminology", () => ({getTerminologyAction:async () => ({overrides:{},locale:"en"})}));
vi.mock("@/lib/actions/tenant-timezone", () => ({getTenantTimezoneAction:async () => "Asia/Kolkata"}));
vi.mock("@/components/booking-screen", () => ({BookingScreen:() => null}));
import OwnerBookingsPage from "@/app/(owner)/owner/bookings/page";
it("admits the supported court-only preset with an explicit booking grant", async () => {
  state.features = new Set(BADMINTON_PRESET_DEFINITION.features);
  expect(state.features.has("pool.booking")).toBe(false);
  await expect(OwnerBookingsPage({})).resolves.toBeTruthy();
});
it("refuses direct access without the booking read grant even with a court entitlement", async () => {
  state.features = new Set(["court.booking"]);
  state.permissions = new Set();
  await expect(OwnerBookingsPage({})).rejects.toThrow("DENIED");
  state.permissions = new Set(["bookings.read"]);
});
it("admits pool booking and refuses a tenant without either entitlement", async () => {
  state.features = new Set(["pool.booking"]);
  await expect(OwnerBookingsPage({})).resolves.toBeTruthy();
  state.features = new Set();
  await expect(OwnerBookingsPage({})).rejects.toThrow("NOT_FOUND");
});
