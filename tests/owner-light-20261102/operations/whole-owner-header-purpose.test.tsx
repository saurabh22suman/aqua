// @vitest-environment jsdom
//
// Owner light · Operations lane (3 November 2026) — the Sessions and Bookings
// page headers.
//
// Two owner pages opened with a line of instruction that repeated what the
// controls underneath already said, and on Sessions the line also promised
// "Today and the next 14 days" while the window control directly beneath it
// offers Today | Next 7 days | All 14 days.
//
// The window belongs to the window control, the price warning belongs to the
// price action and the cancellation warning belongs to the cancel action.
// These cases render the REAL pages and assert that the header no longer
// carries the instruction, while every control and every consequential
// warning stays exactly where it was.
//
// Owner: operations lane
// Scope: /owner/sessions + /owner/bookings headers.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ctx: {
    tenantId: "t-1",
    roleKey: "owner",
    permissions: new Set([
      "attendance.read",
      "programs.read",
      "programs.write",
      "bookings.read",
      "bookings.write",
      "settings.manage",
    ]),
    allLocations: false,
    locationIds: ["loc-1"],
  },
  /** One scheduled session on 2 November 2026, 18:00 IST. */
  sessions: [
    {
      id: "s-1",
      sessionDate: "2026-11-02",
      startsAt: new Date("2026-11-02T12:30:00.000Z"),
      endsAt: new Date("2026-11-02T13:30:00.000Z"),
      batchId: "b-1",
      batchName: "Evening Squad",
      coachId: "coach-1",
      coachName: "Asha Menon",
      status: "scheduled",
    },
  ],
  prices: { active: 3 },
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => mocks.ctx,
  requirePagePermission: () => {},
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => mocks.ctx,
}));

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (
    ctx: { permissions: Set<string> },
    permission: string,
  ) => ctx.permissions.has(permission),
  hasFeature: () => true,
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/services/coach-schedule", () => ({
  listUpcomingSessions: async () => mocks.sessions,
}));

vi.mock("@/lib/services/programs", () => ({
  listCoaches: async () => [],
}));

vi.mock("@/lib/actions/booking-price-admin", () => ({
  getBookingPriceStatusAction: async () => mocks.prices,
}));

vi.mock("@/lib/actions/bookings", () => ({
  listBookableFacilitiesAction: async () => [
    {
      id: "f-1",
      name: "Main court",
      kind: "court",
      capacity: 4,
      locationId: "loc-1",
      locationName: "Worli",
      subUnits: [],
    },
  ],
  listBookingsAction: async () => [],
  quoteBookingAction: async () => ({
    ok: false as const,
    error: "No quote in this test.",
  }),
  createBookingAction: async () => ({
    ok: false as const,
    error: "No booking created in this test.",
  }),
  cancelBookingAction: async () => ({ ok: true as const }),
  requestBookingBillAction: async () => ({
    ok: false as const,
    error: "No bill raised in this test.",
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

vi.mock("@/lib/actions/session-lifecycle", () => ({
  cancelSessionAction: async () => ({ ok: true as const }),
  rescheduleSessionAction: async () => ({ ok: true as const }),
}));

vi.mock("@/lib/actions/coach-substitution", () => ({
  substituteCoachAction: async () => ({ ok: true as const }),
}));

import SessionsPage from "@/app/(owner)/owner/sessions/page";
import BookingsPage from "@/app/(owner)/owner/bookings/page";

afterEach(() => {
  cleanup();
  mocks.prices = { active: 3 };
});

async function renderSessions() {
  const page = await SessionsPage();
  render(page);
}

async function renderBookings() {
  const page = await BookingsPage({
    searchParams: Promise.resolve({}),
  });
  render(page);
}

describe("INTENDED RED — the Sessions and Bookings headers carry no instruction line", () => {
  it("opens Sessions with its title and nothing else in the heading", async () => {
    await renderSessions();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Sessions");
    expect(document.body.textContent).not.toMatch(
      /Substitute a coach when someone is unavailable/i,
    );
    expect(document.body.textContent).not.toMatch(/Today and the next 14 days/i);
  });

  it("opens Bookings with its title and nothing else in the heading", async () => {
    await renderBookings();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Bookings");
    expect(document.body.textContent).not.toMatch(
      /Choose a slot on the day board/i,
    );
  });
});

describe("baseline — the controls and warnings this change must not touch", () => {
  it("keeps the session window control naming its own windows", async () => {
    await renderSessions();

    const range = screen.getByTestId("session-range");
    expect(range.textContent).toContain("Today");
    expect(range.textContent).toContain("Next 7 days");
    expect(range.textContent).toContain("All 14 days");
    const pressed = range.querySelectorAll('[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
  });

  it("keeps the Sessions page's own action", async () => {
    await renderSessions();

    const action = screen.getByRole("link", { name: /schedule grid/i });
    expect(action.getAttribute("href")).toBe("/owner/schedule");
  });

  it("keeps the price warning and the price action on Bookings", async () => {
    mocks.prices = { active: 0 };
    await renderBookings();

    expect(
      screen.getByTestId("owner-bookings-no-price").textContent,
    ).toMatch(/no price is configured/i);
    expect(
      screen.getByTestId("owner-bookings-manage-prices").textContent,
    ).toMatch(/manage booking prices/i);
  });

  it("keeps the cancellation warning at the cancel action", async () => {
    await renderSessions();

    fireEvent.click(screen.getByTestId("manage-session-s-1"));
    fireEvent.click(screen.getByTestId("cancel-open-s-1"));

    expect(
      screen.getByText(/cancel this session\? the register keeps any marks/i),
    ).toBeTruthy();
  });
});
