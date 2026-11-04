// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined, rows: [] as Array<{id:string;name:string;locationId:string;locationName:string;kind:string;capacity:number;subUnits:never[]}> }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ permissions: new Set(["bookings.read", "settings.manage"]), features: new Set(["pool.booking"]) }), requirePagePermission: vi.fn() }));
vi.mock("@/lib/auth/permission", () => ({ hasFeature: () => true, hasPermission: () => true }));
vi.mock("@/lib/actions/bookings", () => ({ listBookableFacilitiesAction: async () => state.rows }));
vi.mock("@/lib/actions/booking-price-admin", () => ({ getBookingPriceStatusAction: async () => ({ active: 1 }) }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/components/booking-screen", () => ({ BookingScreen: ({facilities}: {facilities: Array<{name:string}>}) => <div data-testid="desk">{facilities.map(x => x.name).join(", ")}</div> }));
import OwnerBookingsPage from "@/app/(owner)/owner/bookings/page";
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", unseen = "33333333-3333-4333-8333-333333333333";
const resource = (id: string, locationId: string) => ({ id, name: `Court ${id}`, locationId, locationName: "Site", kind: "court", capacity: 4, subUnits: [] });
afterEach(() => { cleanup(); state.cookie = undefined; state.rows = []; });
it("query location overrides cookie and selects only authorized resources at that location", async () => {
 state.cookie = a; state.rows = [resource("A",a), resource("B",b)];
 render(await OwnerBookingsPage({ searchParams: Promise.resolve({ facility: b }) }));
 expect(screen.getByTestId("desk").textContent).toBe("Court B");
});
it("a requested location absent from the authorized list never falls back to another location", async () => {
 state.rows = [resource("A",a)];
 render(await OwnerBookingsPage({ searchParams: Promise.resolve({ facility: unseen }) }));
 expect(screen.queryByTestId("desk")).toBeNull();
 expect(screen.getByText(/no bookable facilities/i)).toBeTruthy();
});
it("the cookie is applied if there is no query; without either all authorized resources remain", async () => {
 state.rows = [resource("A",a), resource("B",b)]; state.cookie = a;
 const view = render(await OwnerBookingsPage({}));
 expect(screen.getByTestId("desk").textContent).toBe("Court A");
 view.unmount(); state.cookie = undefined;
 render(await OwnerBookingsPage({}));
 expect(screen.getByTestId("desk").textContent).toBe("Court A, Court B");
});
it("applies the location cookie with an empty page props object", async () => {
 state.rows = [resource("A", a), resource("B", b)]; state.cookie = b;
 render(await OwnerBookingsPage({}));
 expect(screen.getByTestId("desk").textContent).toBe("Court B");
});
