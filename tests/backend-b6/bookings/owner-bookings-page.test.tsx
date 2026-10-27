// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Batch 6 — the owner bookings page: its guards and its states.
//
// The page has to say four different things honestly, and a failure to
// read must never look like an empty board:
//
//   * no facilities exist → say so and point at the setup screen;
//   * facilities exist but no price is configured → say so and point at
//     the price screen (this is the dead end that hid the reception
//     counter);
//   * the facility list could not be READ → say that, and do not
//     pretend the club has no facilities;
//   * the tenant's booking feature is off, or the caller lacks the
//     booking permission → the route does not exist for them.

const mocks = vi.hoisted(() => ({
  ctx: {
    tenantId: "" as string,
    userId: "" as string,
    permissions: new Set<string>(),
    features: new Set<string>(),
  },
  facilities: [] as Array<{
    id: string;
    name: string;
    kind: string;
    capacity: number;
    locationId: string;
    locationName: string;
    subUnits: Array<{ id: string; name: string }>;
  }>,
  priceStatus: { total: 0, active: 0 },
  facilitiesError: false,
  priceError: false,
}));

vi.mock("@/lib/auth/surface-guard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/surface-guard")>();
  return { ...actual, requireOwner: async () => mocks.ctx };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/lib/actions/bookings", () => ({
  listBookableFacilitiesAction: async () => {
    if (mocks.facilitiesError) throw new Error("read failed");
    return mocks.facilities;
  },
}));

vi.mock("@/lib/actions/booking-price-admin", () => ({
  getBookingPriceStatusAction: async () => {
    if (mocks.priceError) throw new Error("read failed");
    return mocks.priceStatus;
  },
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/components/booking-screen", () => ({
  BookingScreen: ({
    facilities,
  }: {
    facilities: Array<{ id: string; name: string }>;
  }) => (
    <div data-testid="booking-screen">
      {facilities.map((facility) => facility.name).join(", ")}
    </div>
  ),
}));

import OwnerBookingsPage from "@/app/(owner)/owner/bookings/page";

const FACILITY = {
  id: "f-1",
  name: "Indoor Court",
  kind: "court",
  capacity: 4,
  locationId: "loc-1",
  locationName: "Worli",
  subUnits: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.facilities = [];
  mocks.priceStatus = { total: 0, active: 0 };
  mocks.facilitiesError = false;
  mocks.priceError = false;
});

function asOwner(overrides?: { permissions?: string[]; features?: string[] }) {
  mocks.ctx.permissions = new Set(
    overrides?.permissions ?? ["bookings.read", "bookings.write", "settings.manage"],
  );
  mocks.ctx.features = new Set(overrides?.features ?? ["pool.booking"]);
}

describe("B6 owner bookings page", () => {
  it("lists the tenant's bookable facilities", async () => {
    asOwner();
    mocks.facilities = [FACILITY];
    mocks.priceStatus = { total: 1, active: 1 };

    render(await OwnerBookingsPage());

    expect(screen.getByTestId("booking-screen").textContent).toContain(
      "Indoor Court",
    );
    expect(screen.queryByTestId("owner-bookings-no-price")).toBeNull();
  });

  it("always offers the entry point to the price screen", async () => {
    asOwner();
    mocks.facilities = [FACILITY];
    mocks.priceStatus = { total: 1, active: 1 };

    render(await OwnerBookingsPage());

    const link = screen.getByTestId("owner-bookings-manage-prices");
    expect(link.getAttribute("href")).toBe("/owner/settings/booking-prices");
  });

  it("hides the price-management entry point from a caller who may not manage prices", async () => {
    // bookings.read without settings.manage: the price screen would
    // 404 for this caller, so the link must not be offered.
    asOwner({ permissions: ["bookings.read"] });
    mocks.facilities = [FACILITY];
    mocks.priceStatus = { total: 0, active: 0 };

    render(await OwnerBookingsPage());

    expect(
      screen.queryByTestId("owner-bookings-manage-prices"),
    ).toBeNull();
    // The fact is still stated — only the route to it is withheld.
    const notice = screen.getByTestId("owner-bookings-no-price");
    expect(notice.textContent).toContain("No price is configured");
    expect(notice.querySelector("a")).toBeNull();
  });

  it("says so when the club has no bookable facility yet", async () => {
    asOwner();
    mocks.facilities = [];

    render(await OwnerBookingsPage());

    expect(document.body.textContent).toContain("No bookable facilities yet");
    const link = screen.getByRole("link", { name: /set up facilities/i });
    expect(link.getAttribute("href")).toBe("/owner/settings/activities");
    expect(screen.queryByTestId("booking-screen")).toBeNull();
  });

  it("says so when no price is configured and points at the price screen", async () => {
    asOwner();
    mocks.facilities = [FACILITY];
    mocks.priceStatus = { total: 0, active: 0 };

    render(await OwnerBookingsPage());

    const notice = screen.getByTestId("owner-bookings-no-price");
    expect(notice.textContent).toContain("No price is configured");
    const link = screen.getByRole("link", { name: /set the prices/i });
    expect(link.getAttribute("href")).toBe("/owner/settings/booking-prices");
  });

  it("reports a failed read instead of an empty board", async () => {
    asOwner();
    mocks.facilitiesError = true;
    mocks.priceError = true;

    render(await OwnerBookingsPage());

    expect(screen.getByTestId("owner-bookings-facilities-error")).toBeTruthy();
    expect(screen.getByTestId("owner-bookings-price-error")).toBeTruthy();
    expect(screen.queryByTestId("booking-screen")).toBeNull();
    expect(document.body.textContent).not.toContain("No bookable facilities yet");
  });

  it("refuses the route when the booking feature is off", async () => {
    asOwner({ features: [] });
    mocks.facilities = [FACILITY];

    await expect(OwnerBookingsPage()).rejects.toThrow(/NEXT_NOT_FOUND/);
  });

  it("refuses the route without the bookings.read permission", async () => {
    asOwner({ permissions: ["settings.manage"] });
    mocks.facilities = [FACILITY];

    await expect(OwnerBookingsPage()).rejects.toThrow(/NEXT_NOT_FOUND/);
  });
});
