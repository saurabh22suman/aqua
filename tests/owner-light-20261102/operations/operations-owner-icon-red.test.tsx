// @vitest-environment jsdom
//
// Owner light — 2 November 2026 — OPERATIONS lane, icon geometry.
//
// The human rejected the baseline's icon pack: the Operations surfaces
// still carry Lucide glyphs where the approved mock carries plain
// outline geometry — a boxed "calendar-days" where the mock has a
// plain calendar, a ticket where the mock has a calendar-with-check, a
// 6-unit chevron where the mock's chevron is drawn on the mock's own
// grid.
//
// Foundation owns the shared typed component
// components/owner-ui/owner-icon.tsx (OwnerIcon). It is consumed here,
// never copied: this lane owns no icon map and no local SVG.
//
// The cases below compare the RENDERED geometry against the approved
// `ICONS` geometry (khelsuite-owner-light-type-mock.html lines 646-672,
// transcribed read-only into this file) with the mock's own renderer
// attributes (24x24 viewBox, fill=none, stroke=currentColor,
// stroke-width 1.8, round caps and joins). The comparison is on the
// rendered DOM, so a failure records the actual geometry in use against
// the accepted one.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [key: string]: unknown;
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
  listBookingsAction: async () => [],
  cancelBookingAction: async () => ({ ok: true as const }),
  requestBookingBillAction: async () => ({
    ok: false as const,
    error: "No bill raised in this test.",
  }),
  quoteBookingAction: async () => ({
    ok: false as const,
    error: "No quote in this test.",
  }),
  createBookingAction: async () => ({
    ok: false as const,
    error: "No booking created in this test.",
  }),
}));

vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "t-1",
    permissions: new Set([
      "attendance.read",
      "programs.read",
      "programs.write",
      "bookings.read",
    ]),
  }),
  requirePagePermission: () => {},
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({
    tenantId: "t-1",
    permissions: new Set(["attendance.read", "programs.write"]),
  }),
}));

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (ctx: { permissions: Set<string> }, permission: string) =>
    ctx.permissions.has(permission),
  hasFeature: () => true,
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [],
}));
vi.mock("@/lib/actions/programs", () => ({
  listProgramsAction: async () => [],
  listBatchesAction: async () => [],
  listCoachesAction: async () => [],
}));
vi.mock("@/lib/services/programs", () => ({
  listCoaches: async () => [],
}));
vi.mock("@/lib/services/coach-schedule", () => ({
  listUpcomingSessions: async () => [],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// The boards themselves are not what this file looks at; the page
// header glyphs are.
vi.mock("@/components/programs-batches-board", () => ({
  ProgramsBatchesBoard: () => null,
}));
vi.mock("@/components/upcoming-sessions-list", () => ({
  UpcomingSessionsList: () => null,
}));

import { OwnerCalendar } from "@/components/owner-calendar/owner-calendar";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";
import { BookingScreen } from "@/components/booking-screen";
import { sessionToCalendarEvent } from "@/components/owner-calendar/calendar-session-event";
import { bookingToCalendarEvent } from "@/components/booking-shared";
import type { CalendarEvent } from "@/components/owner-calendar/calendar-model";
import OwnerProgramsPage from "@/app/(owner)/owner/programs/page";
import OwnerSessionsPage from "@/app/(owner)/owner/sessions/page";

afterEach(cleanup);

/** The mock's renderer attributes, in the order this file compares them. */
const APPROVED_SVG =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

/**
 * The approved geometry, transcribed from the mock's `ICONS` block.
 *
 * Child attributes are sorted by name so the comparison does not depend
 * on the order a renderer happens to emit them.
 */
const APPROVED = {
  // A plain calendar: rings and one divider. Not a boxed-slots
  // "calendar-days".
  calendar: `${APPROVED_SVG} <rect height="15" rx="2" width="17" x="3.5" y="5.5"><path d="M8 3.5v4M16 3.5v4M3.5 10h17">`,
  // A booking: the plain calendar with a check.
  booking: `${APPROVED_SVG} <rect height="15" rx="2" width="17" x="3.5" y="5.5"><path d="M8 3.5v4M16 3.5v4M9 13.5l2 2 4-4">`,
  // The alert triangle.
  alert: `${APPROVED_SVG} <path d="M12 4.5 21 19.5H3z"><path d="M12 10v4.5M12 17h.01">`,
  // The chevrons the calendar's previous/next controls use.
  left: `${APPROVED_SVG} <path d="m15 5-7 7 7 7">`,
  chevron: `${APPROVED_SVG} <path d="m9 5 7 7-7 7">`,
} as const;

const SVG_ATTRIBUTES = [
  "viewBox",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
];

/** The rendered geometry of one icon: its outline attributes and shapes. */
function signature(svg: SVGElement): string {
  const attributes: string[] = [];
  for (const name of SVG_ATTRIBUTES) {
    const value = svg.getAttribute(name);
    if (value !== null) attributes.push(`${name}="${value}"`);
  }
  const shapes = Array.from(svg.children)
    .map((child) => {
      const childAttributes = Array.from(child.attributes)
        .map((attribute) => `${attribute.name}="${attribute.value}"`)
        .sort()
        .join(" ");
      return `<${child.tagName.toLowerCase()}${
        childAttributes ? ` ${childAttributes}` : ""
      }>`;
    })
    .join("");
  return `${attributes.join(" ")} ${shapes}`;
}

const LABELS = { batch: "Batch", booking: "Booking" };

/** An 18:00–19:00 IST batch session on 2 November 2026. */
const SESSION = {
  id: "s-1",
  sessionDate: "2026-11-02",
  startsAt: "2026-11-02T12:30:00.000Z",
  endsAt: "2026-11-02T13:30:00.000Z",
  status: "scheduled",
  batchId: "b-1",
  batchName: "Evening Squad",
  capacity: 12,
  enrolled: 8,
  locationId: "loc-1",
  locationName: "Worli",
  coachName: "Asha Menon",
};

/** A booked 18:00–19:00 IST slot on the same day. */
const BOOKED_ROW = {
  bookingId: "b-2",
  facilityId: "f-1",
  facilityName: "Main court",
  subUnitId: null,
  subUnitName: null,
  locationId: "loc-1",
  locationName: "Worli",
  memberId: "m-1",
  memberName: "Rohan Shah",
  walkInName: null,
  startsAt: "2026-11-02T12:30:00.000Z",
  endsAt: "2026-11-02T13:30:00.000Z",
  status: "confirmed",
  pricePaise: 50000,
  invoiceId: null,
  invoiceNumber: null,
  amountDuePaise: 0,
  billable: true,
};

function renderCalendar(events: CalendarEvent[]) {
  return render(
    <OwnerCalendar
      events={events}
      days={["2026-11-02"]}
      selectedDate="2026-11-02"
      todayDate="2026-11-02"
      view="day"
      labels={LABELS}
      empty={{ title: "Nothing scheduled", body: "Nothing scheduled." }}
    />,
  );
}

describe("the Operations icons carry the approved mock geometry", () => {
  it("draws a session on the plain approved calendar, not a boxed-slots calendar", () => {
    const event = sessionToCalendarEvent(SESSION, "coach-1", "bg-water");
    renderCalendar([event]);

    const svg = screen
      .getByTestId("calendar-event")
      .querySelector("svg") as SVGElement;
    expect(signature(svg)).toBe(APPROVED.calendar);
  });

  it("draws a booking on the approved booking geometry, not a ticket", () => {
    renderCalendar([bookingToCalendarEvent(BOOKED_ROW)]);

    const svg = screen
      .getByTestId("calendar-event")
      .querySelector("svg") as SVGElement;
    expect(signature(svg)).toBe(APPROVED.booking);
  });

  it("draws the phone agenda on the same approved geometry as the block", () => {
    // The agenda is the phone's view of the same events, so its glyphs
    // must be the same ones.
    renderCalendar([bookingToCalendarEvent(BOOKED_ROW)]);

    const svg = screen
      .getByTestId("calendar-agenda-item")
      .querySelector("svg") as SVGElement;
    expect(signature(svg)).toBe(APPROVED.booking);
  });

  it("draws the resource clash on the approved alert triangle", () => {
    const first = sessionToCalendarEvent(SESSION, "coach-1", "bg-water");
    const second = sessionToCalendarEvent(
      {
        ...SESSION,
        id: "s-2",
        startsAt: "2026-11-02T13:00:00.000Z",
        endsAt: "2026-11-02T14:00:00.000Z",
        batchName: "Morning Squad",
      },
      "coach-1",
      "bg-water",
    );
    const { container } = renderCalendar([first, second]);

    const svg = container.querySelector(
      '[data-testid="calendar-clash"] svg',
    ) as SVGElement;
    expect(signature(svg)).toBe(APPROVED.alert);
  });

  it("draws the schedule's previous and next controls on the approved chevrons", () => {
    render(
      <OwnerScheduleGrid
        view="week"
        locations={[]}
        sessions={[SESSION]}
        days={["2026-11-02"]}
        monthCells={null}
        prevHref="/owner/schedule"
        nextHref="/owner/schedule"
        todayHref="/owner/schedule"
      />,
    );

    const previous = screen
      .getByTestId("calendar-previous")
      .querySelector("svg") as SVGElement;
    const next = screen
      .getByTestId("calendar-next")
      .querySelector("svg") as SVGElement;
    expect(signature(previous)).toBe(APPROVED.left);
    expect(signature(next)).toBe(APPROVED.chevron);
  });

  it("draws the booking desk's previous and next controls on the approved chevrons", () => {
    render(
      <BookingScreen
        facilities={[
          {
            id: "f-1",
            name: "Main court",
            kind: "court",
            capacity: 4,
            locationId: "loc-1",
            locationName: "Worli",
            subUnits: [],
          },
        ]}
        timezone="Asia/Kolkata"
        today="2026-11-02"
        terminology={{ locale: "en", overrides: {} }}
      />,
    );

    const previous = screen
      .getByTestId("calendar-previous")
      .querySelector("svg") as SVGElement;
    const next = screen
      .getByTestId("calendar-next")
      .querySelector("svg") as SVGElement;
    expect(signature(previous)).toBe(APPROVED.left);
    expect(signature(next)).toBe(APPROVED.chevron);
  });

  it("draws the programs page's header actions on the approved calendar", async () => {
    const page = await OwnerProgramsPage({ searchParams: Promise.resolve({}) });
    const { container } = render(page);

    const icons = Array.from(container.querySelectorAll("svg"));
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(signature(icon as SVGElement)).toBe(APPROVED.calendar);
    }
  });

  it("draws the sessions page's header action on the approved calendar", async () => {
    const page = await OwnerSessionsPage();
    const { container } = render(page);

    // The page's own header action. The shared BackLink above it draws
    // the shared back chevron and is not this lane's glyph.
    const action = Array.from(container.querySelectorAll("a")).find((link) =>
      (link.textContent ?? "").includes("Schedule grid"),
    );
    expect(action).toBeTruthy();
    const icon = action!.querySelector("svg") as SVGElement;
    expect(signature(icon)).toBe(APPROVED.calendar);
  });
});
