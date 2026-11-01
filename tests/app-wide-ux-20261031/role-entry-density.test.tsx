// @vitest-environment jsdom
//
// Coach Today and staff self-service — density and desktop/phone
// composition (tranche 3, 31 Oct 2026).
//
// What is still open from tranche 2: the coach Today page still uses
// the tall `pt-10` top padding, and the self-service surfaces are
// full-bleed on a wide screen — the coach, worker and reception entry
// pages stretch edge to edge at 1280 px, so the reading measure is
// unbounded.
//
// The contract this file pins (LAYOUT INTENT):
//
//   1. No role entry surface uses the tall phone top padding.
//   2. Every role entry surface declares a BOUNDED readable frame, so
//      the content does not run the full width of a desktop window.
//   3. Nothing is shrunk to make room: no text below 12 px and no
//      target below the comfortable minimum (LAYOUT INTENT — the real
//      geometry is the coordinator's Chrome measurement, not this file).
//   4. Role-owned data and actions survive: the coach's register
//      shortcut, the up-next card, the three self-service cards, and
//      the curriculum link for the coach who holds `levels.write` —
//      and NOT for the coach who does not.
//   5. A long label is carried in full.
//
// This file records LAYOUT INTENT only. It cannot certify visual
// quality, and it does not claim a visual verdict.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/",
}));

let PERMISSIONS = new Set<string>();

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (_ctx: unknown, permission: string) => PERMISSIONS.has(permission),
  requirePermission: (_ctx: unknown, permission: string) => {
    if (!PERMISSIONS.has(permission)) throw new Error("ForbiddenError");
  },
  hasFeature: () => false,
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({
    roleKey: "worker",
    tenantId: "t1",
    permissions: PERMISSIONS,
  }),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireCoach: async () => ({ roleKey: "coach", tenantId: "t1", permissions: PERMISSIONS }),
  requireReception: async () => ({ roleKey: "reception", tenantId: "t1", permissions: PERMISSIONS }),
}));

vi.mock("@/lib/services/staff", () => ({
  getCurrentStaffIdentity: async () => ({
    fullName: "Asha Rao",
    phone: "+919876543210",
  }),
}));

vi.mock("@/lib/actions/shifts", () => ({
  listMyShiftsAction: async () => [
    {
      id: "sh1",
      shiftDate: "2026-10-31",
      startAt: "2026-10-31T09:00:00Z",
      endAt: "2026-10-31T12:00:00Z",
    },
  ],
}));

vi.mock("@/lib/actions/staff-attendance", () => ({
  getMyAttendanceAction: async () => ({
    checkedInAt: "2026-10-31T03:30:00Z",
    checkedOutAt: null,
    lateMinutes: 5,
    status: "present",
    note: null,
  }),
}));

vi.mock("@/lib/actions/leave", () => ({
  listLeaveTypesAction: async () => [
    { id: "lt1", name: "Casual leave", isPaid: true },
  ],
  listMyLeaveAction: async () => ({
    balances: [
      {
        leaveTypeId: "lt1",
        name: "Casual leave",
        isPaid: true,
        annualQuota: 12,
        availableDays: 9,
        pendingDays: 1,
      },
    ],
    requests: [
      {
        id: "lr1",
        leaveTypeName: "Casual leave",
        days: 1,
        fromDate: "2026-11-02",
        toDate: "2026-11-02",
        status: "pending",
        decisionNote: null,
      },
    ],
  }),
}));

let COACH_SESSIONS: unknown[] = [];
let COACH_NEXT: unknown = null;

vi.mock("@/lib/actions/coach", () => ({
  getCoachHomeAction: async () => ({ sessions: COACH_SESSIONS, next: COACH_NEXT }),
}));

// The client-only leaves of the self-service cards are stubbed so the
// test reads the page's own composition and not a client island.
vi.mock("@/components/staff-check-in-controls", () => ({
  StaffCheckInControls: () => null,
}));
vi.mock("@/components/deferred-leave-request", () => ({
  DeferredLeaveRequest: () => null,
}));
vi.mock("@/components/cancel-leave-button", () => ({
  CancelLeaveButton: () => null,
}));
vi.mock("@/components/tenant-sign-out", () => ({
  TenantSignOut: () => null,
}));

import CoachTodayPage from "@/app/(coach)/coach/page";
import WorkerHomePage from "@/app/(worker)/worker/page";
import CoachMePage from "@/app/(coach)/coach/me/page";
import ReceptionMePage from "@/app/(reception)/reception/me/page";

/** LAYOUT INTENT: a bounded, readable frame on a wide screen. */
function expectBoundedFrame(container: HTMLElement) {
  const main = container.querySelector("main");
  expect(main).toBeTruthy();
  const classes = main?.getAttribute("class") ?? "";
  expect(classes).toMatch(/max-w-/);
}

/** LAYOUT INTENT: no tall phone top padding. */
function expectCompactTopPadding(container: HTMLElement) {
  const main = container.querySelector("main");
  const classes = main?.getAttribute("class") ?? "";
  expect(classes).not.toContain("pt-10");
}

/** LAYOUT INTENT: nothing is shrunk below the readable minimum. */
function expectReadableText(container: HTMLElement) {
  const tiny: string[] = [];
  for (const element of Array.from(container.querySelectorAll("*"))) {
    const classes = element.getAttribute("class") ?? "";
    for (const match of classes.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (Number(match[1]) < 12) tiny.push(classes);
    }
  }
  expect(tiny).toHaveLength(0);
}

/** LAYOUT INTENT: no target is shrunk below the comfortable minimum. */
function expectComfortableTargets(container: HTMLElement) {
  const tiny: string[] = [];
  for (const element of Array.from(container.querySelectorAll("*"))) {
    const classes = element.getAttribute("class") ?? "";
    for (const match of classes.matchAll(/min-h-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (Number(match[1]) < 40) tiny.push(classes);
    }
  }
  expect(tiny).toHaveLength(0);
}

/**
 * A Tailwind gap token in pixels. The numeric scale is 0.25rem per
 * unit (4px); an arbitrary value is read as px or rem.
 */
function gapPx(token: string): number {
  const arbitrary = token.match(/^\[([^\]]+)\]$/);
  if (arbitrary) {
    const value = arbitrary[1]!;
    const px = value.match(/^(\d+(?:\.\d+)?)px$/);
    if (px) return Number(px[1]);
    const rem = value.match(/^(\d+(?:\.\d+)?)rem$/);
    if (rem) return Number(rem[1]) * 16;
    return 0;
  }
  const units = Number(token);
  return Number.isFinite(units) ? units * 4 : 0;
}

beforeEach(() => {
  PERMISSIONS = new Set(["staff.self", "members.read", "levels.write"]);
  COACH_SESSIONS = [];
  COACH_NEXT = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("coach Today — compact, bounded, and still actionable", () => {
  it("drops the tall top padding and declares a bounded frame", async () => {
    const { container } = render(await CoachTodayPage());
    expectCompactTopPadding(container);
    expectBoundedFrame(container);
  });

  it("keeps the day's sessions and the register shortcut", async () => {
    COACH_SESSIONS = [
      {
        id: "cs1",
        startsAt: "2026-10-31T04:00:00Z",
        batchName: "Morning Squad",
        total: 12,
        marked: 5,
      },
    ];
    const { container } = render(await CoachTodayPage());
    const card = screen.getByTestId("coach-today-session");
    // The coach's own data survives.
    expect(card.textContent ?? "").toContain("Morning Squad");
    expect(card.textContent ?? "").toContain("5 / 12");
    // The action survives.
    expect(card.textContent ?? "").toMatch(/open register/i);
    expect(card.getAttribute("href")).toBe("/coach/register/cs1");
    expectReadableText(container);
    expectComfortableTargets(container);
  });

  it("carries a long label in full", async () => {
    const longName =
      "Advanced Competitive Development Squad — Level 4 Water Polo";
    COACH_SESSIONS = [
      {
        id: "cs1",
        startsAt: "2026-10-31T04:00:00Z",
        batchName: longName,
        total: 14,
        marked: 0,
      },
    ];
    render(await CoachTodayPage());
    const card = screen.getByTestId("coach-today-session");
    expect(card.textContent ?? "").toContain(longName);
  });

  it("keeps the long title and the count apart on a narrow screen (LAYOUT INTENT)", async () => {
    // The coordinator's Chrome review found the session title and the
    // enrolment count TOUCHING at 390 px with a long batch name
    // (.playwright-mcp/app-wide-ux-20261031/chrome-production-1/screenshots/coach-0-lavender-390.png).
    // The header row has no column gap at all, so a long title runs
    // into the count.
    //
    // LAYOUT INTENT — this asserts the intended COMPOSITION, not a
    // measurement. The real geometry is the coordinator's Chrome pass
    // after the rebuild.
    const longName =
      "Advanced Competitive Development Squad — Level 4 Water Polo";
    COACH_SESSIONS = [
      {
        id: "cs1",
        startsAt: "2026-10-31T04:00:00Z",
        batchName: longName,
        total: 14,
        marked: 0,
      },
    ];
    render(await CoachTodayPage());
    const card = screen.getByTestId("coach-today-session");
    const header = card.firstElementChild as HTMLElement;
    expect(header).toBeTruthy();

    // A DELIBERATE column gap of at least 8px between the title and
    // the count.
    const gap = (header.getAttribute("class") ?? "").match(
      /(?:^|\s)(?:[a-z0-9-]+:)?gap-(\d+(?:\.\d+)?|\[[^\]]+\])(?=\s|$)/,
    );
    expect(gap, "the title row declares no column gap").not.toBeNull();
    expect(gapPx(gap![1]!)).toBeGreaterThanOrEqual(8);

    // The title is BOUNDED and WRAPS — it is never clipped, so the
    // whole batch name stays readable.
    const title = header.children[0] as HTMLElement;
    const titleClasses = title.getAttribute("class") ?? "";
    expect(titleClasses).toMatch(/min-w-0|break-words|whitespace-normal/);
    expect(titleClasses).not.toMatch(/truncate|whitespace-nowrap/);

    // The count is never squeezed.
    const count = header.children[1] as HTMLElement;
    expect(count.getAttribute("class") ?? "").toMatch(/flex-none|shrink-0/);

    // …and both are still there, in full.
    expect(card.textContent ?? "").toContain(longName);
    expect(card.textContent ?? "").toContain("0 / 14");
  });

  it("keeps the quiet-day state useful", async () => {
    COACH_SESSIONS = [];
    COACH_NEXT = null;
    const { container } = render(await CoachTodayPage());
    const empty = screen.getByTestId("coach-home-empty");
    expect(empty.textContent ?? "").toMatch(/no sessions scheduled/i);
    expect(within(empty).getByRole("link", { name: /open schedule/i })).toBeTruthy();
    expectCompactTopPadding(container);
    expectBoundedFrame(container);
  });

  it("keeps the up-next card and its verb", async () => {
    COACH_SESSIONS = [];
    COACH_NEXT = {
      id: "cs9",
      startsAt: "2026-10-31T11:00:00Z",
      sessionDate: "2026-10-31",
      batchName: "Evening Juniors",
      total: 9,
    };
    render(await CoachTodayPage());
    const next = screen.getByTestId("coach-up-next");
    expect(next.textContent ?? "").toContain("Evening Juniors");
    expect(next.textContent ?? "").toMatch(/open register/i);
  });
});

describe("staff self-service — the Me surfaces", () => {
  it("gives the worker page a bounded frame and a compact top padding", async () => {
    const { container } = render(await WorkerHomePage());
    expectCompactTopPadding(container);
    expectBoundedFrame(container);
    // The three self-service cards survive.
    expect(screen.getByRole("heading", { name: /my shifts/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /today's attendance/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^leave$/i })).toBeTruthy();
    // …with the caller's own data.
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    expect(screen.getAllByText(/casual leave/i).length).toBeGreaterThan(0);
    expectComfortableTargets(container);
  });

  it("gives the coach Me page a bounded frame and a compact top padding", async () => {
    const { container } = render(await CoachMePage());
    expectCompactTopPadding(container);
    expectBoundedFrame(container);
    expect(screen.getByRole("heading", { name: /my shifts/i })).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
  });

  it("gives the reception Me page a bounded frame and a compact top padding", async () => {
    const { container } = render(await ReceptionMePage());
    expectCompactTopPadding(container);
    expectBoundedFrame(container);
    expect(screen.getByRole("heading", { name: /my shifts/i })).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
  });

  it("shows the curriculum link only to a coach who may edit levels", async () => {
    PERMISSIONS = new Set(["staff.self", "members.read"]);
    const { unmount } = render(await CoachMePage());
    expect(screen.queryByTestId("coach-curriculum-link")).toBeNull();
    unmount();

    PERMISSIONS = new Set(["staff.self", "members.read", "levels.write"]);
    render(await CoachMePage());
    expect(screen.getByTestId("coach-curriculum-link")).toBeTruthy();
  });
});
