// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Booking price catalogue (management page ownership).
//
// The rule list must label a batch/shape with the tenant's vocabulary, so
// the page has to hand the resolved terminology state to the Scheduling
// manager. This test renders the real page with a probe manager and fails
// if the swim vocabulary never reaches it.

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

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["settings.manage"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("@/lib/actions/activities", () => ({
  listActivitiesAction: async () => [
    {
      id: "act-1",
      name: "Main pool",
      locationId: "loc-1",
      locationName: "Worli Main",
    },
  ],
}));

vi.mock("@/lib/actions/booking-price-admin", () => ({
  listBookingPriceRulesAction: async () => [],
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({
    locale: "en",
    overrides: { batch: { en: { one: "Lane", other: "Lanes" } } },
  }),
}));

vi.mock("@/components/bookings/booking-price-manager", () => ({
  BookingPriceManager: (props: {
    terminology?: {
      overrides: Record<string, { en?: { one?: string } }>;
    };
  }) => (
    <div data-testid="booking-price-manager">
      {props.terminology?.overrides.batch?.en?.one ?? "no terminology"}
    </div>
  ),
}));

import BookingPricesPage from "@/app/(owner)/owner/settings/booking-prices/page";

afterEach(cleanup);

describe("booking prices page wiring", () => {
  it("passes the tenant terminology state to the manager", async () => {
    render(await BookingPricesPage());

    expect(screen.getByTestId("booking-price-manager").textContent).toBe(
      "Lane",
    );
  });
});
