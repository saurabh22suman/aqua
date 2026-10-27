import { describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

// Batch 6 — the authorization boundary of the booking actions.
//
// The booking actions existed before this batch (they are the
// reception counter's). What this batch adds is an OWNER route on top
// of them, so the boundary that matters is: which role may take a
// booking, and what happens when the tenant's booking feature is off.
//
// The rules:
//   * a role without `bookings.write` (a coach, an accountant) cannot
//     create or cancel a booking;
//   * a role without `bookings.read` cannot list or quote;
//   * `bookings.*` resolves against the `pool.booking` FEATURE, so an
//     owner whose tenant has the feature switched off is refused —
//     the grant alone is not enough;
//   * invalid input is refused before the permission check runs, so a
//     malformed request never reaches a service.
//
// `requireDefaultCtx` is mocked so the gate runs against a synthetic
// role context; `requirePermission` is the REAL implementation.

const mocks = vi.hoisted(() => ({
  ctx: {
    tenantId: "" as string,
    userId: "" as string,
    permissions: new Set<string>(),
    features: new Set<string>(),
    requestId: "b6-booking-auth",
  },
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => mocks.ctx,
}));

import {
  cancelBookingAction,
  createBookingAction,
  listBookableFacilitiesAction,
  listBookingsAction,
  quoteBookingAction,
} from "@/lib/actions/bookings";

function asRole(
  permissions: string[],
  features: string[] = ["pool.booking"],
): void {
  mocks.ctx.tenantId = uuidv7();
  mocks.ctx.userId = uuidv7();
  mocks.ctx.permissions = new Set(permissions);
  mocks.ctx.features = new Set(features);
}

describe("B6 booking actions — authorization", () => {
  it("refuses a role without bookings.write from taking a booking", async () => {
    asRole(["bookings.read", "members.read"]);

    await expect(
      createBookingAction({
        facilityId: uuidv7(),
        walkInName: "Coach Guest",
        startsAt: "2026-10-28T04:00:00.000Z",
        endsAt: "2026-10-28T05:00:00.000Z",
      }),
    ).rejects.toThrow(/forbidden/);

    await expect(
      cancelBookingAction({ bookingId: uuidv7() }),
    ).rejects.toThrow(/forbidden/);
  });

  it("refuses a role without bookings.read from reading the board", async () => {
    asRole(["members.read", "invoices.read"]);

    await expect(listBookableFacilitiesAction()).rejects.toThrow(/forbidden/);
    await expect(
      listBookingsAction({ date: "2026-10-28" }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      quoteBookingAction({
        facilityId: uuidv7(),
        startsAt: "2026-10-28T04:00:00.000Z",
      }),
    ).rejects.toThrow(/forbidden/);
  });

  it("refuses every booking action when the booking feature is off", async () => {
    asRole(["bookings.read", "bookings.write"], []);

    await expect(
      createBookingAction({
        facilityId: uuidv7(),
        walkInName: "Owner Guest",
        startsAt: "2026-10-28T04:00:00.000Z",
        endsAt: "2026-10-28T05:00:00.000Z",
      }),
    ).rejects.toThrow(/feature_disabled/);

    await expect(listBookableFacilitiesAction()).rejects.toThrow(
      /feature_disabled/,
    );
  });

  it("refuses invalid input before it reaches the permission check", async () => {
    asRole([]);
    const result = await createBookingAction({
      facilityId: uuidv7(),
      walkInName: "Owner Guest",
      startsAt: "2026-10-28T05:00:00.000Z",
      endsAt: "2026-10-28T04:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/after/i);
  });

  it("refuses a malformed date rather than reading the whole day", async () => {
    asRole(["bookings.read"]);
    await expect(listBookingsAction({ date: "not-a-date" })).resolves.toEqual(
      [],
    );
  });
});
