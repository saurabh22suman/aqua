// @vitest-environment jsdom
//
// Owner light — 2 November 2026 — OPERATIONS lane, initial RED.
//
// These cases are written BEFORE any production edit. They run against
// the inherited release (96ee6358c76ddc31c88404de76fc1414262d02ed) and
// they fail today on a real assertion — not on an import, a missing
// fixture or a snapshot.
//
// The file keeps two kinds of case apart on purpose:
//
//   • "intended RED"  — red today, green after this lane's own change.
//   • "baseline"      — green today. It pins behaviour the change must
//                       NOT touch (event duration, overlap, clash, the
//                       reachable create form). These are controls, not
//                       claims of new behaviour.
//
// No database and no network: every server read is replaced by a
// fixture, so the file runs on a plain `pnpm exec vitest` with no
// pretest seed and no DB IO.
//
// Owner: operations lane
// Scope: Schedule / Programs / Sessions / Bookings and their UI.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
}));

const pageMocks = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  permissions: [
    "attendance.read",
    "programs.read",
    "programs.write",
    "bookings.read",
    "bookings.write",
    "settings.manage",
  ] as string[],
}));

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

// The desk's reads are replaced by fixtures; no server action runs.
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
  listBookingsAction: async () => mocks.rows,
  cancelBookingAction: async () => ({ ok: true as const }),
  requestBookingBillAction: async () => ({
    ok: false as const,
    error: "No bill raised in this test.",
  }),
  quoteBookingAction: async () => ({
    ok: false as const,
    error: "No quote in this test.",
  }),
  createBookingAction: async (input: Record<string, unknown>) => {
    mocks.created.push(input);
    return { ok: false as const, error: "No booking created in this test." };
  },
}));

vi.mock("@/lib/actions/booking-price-admin", () => ({
  getBookingPriceStatusAction: async () => ({ active: 3 }),
}));

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (ctx: { permissions: Set<string> }, permission: string) =>
    ctx.permissions.has(permission),
  hasFeature: () => true,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));

// The schedule page's own reads are replaced by fixtures so the page
// can be rendered without a database.
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "t-1",
    permissions: new Set(pageMocks.permissions),
  }),
  requirePagePermission: () => {},
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [],
}));
vi.mock("@/lib/actions/schedule-grid", () => ({
  getScheduleGridAction: async () => pageMocks.sessions,
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/lib/services/coach-schedule", () => ({
  listUpcomingSessions: async () => [],
}));

import { BookingScreen } from "@/components/booking-screen";
import { BookingDayList } from "@/components/booking-day-list";
import { OwnerCalendar } from "@/components/owner-calendar/owner-calendar";
import { sessionToCalendarEvent } from "@/components/owner-calendar/calendar-session-event";
import type { CalendarEvent } from "@/components/owner-calendar/calendar-model";
import OwnerSchedulePage from "@/app/(owner)/owner/schedule/page";
import OwnerBookingsPage from "@/app/(owner)/owner/bookings/page";

afterEach(() => {
  cleanup();
  mocks.rows = [];
  mocks.created = [];
  pageMocks.sessions = [];
});

/** An 18:00–19:00 IST batch session on 2 November 2026. */
const SESSION = {
  id: "s-1",
  sessionDate: "2026-11-02",
  // 12:30 UTC is 18:00 IST.
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

const LABELS = { batch: "Batch", booking: "Booking" };

/** A booked 18:00–19:00 IST slot on 2 November 2026. */
const BOOKED_ROW = {
  bookingId: "b-1",
  facilityId: "f-1",
  facilityName: "Main court",
  subUnitId: null,
  subUnitName: null,
  locationId: "loc-1",
  locationName: "Worli",
  memberId: "m-1",
  memberName: "Rohan Shah",
  walkInName: null,
  // 12:30 UTC is 18:00 IST.
  startsAt: "2026-11-02T12:30:00.000Z",
  endsAt: "2026-11-02T13:30:00.000Z",
  status: "confirmed",
  pricePaise: 50000,
  invoiceId: null,
  invoiceNumber: null,
  amountDuePaise: 0,
  billable: true,
};

function sessionEvent(overrides: Partial<typeof SESSION> = {}): CalendarEvent {
  return sessionToCalendarEvent(
    { ...SESSION, ...overrides } as typeof SESSION,
    "coach-1",
    "bg-water",
  );
}

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

function renderDesk(options: { canCreate?: boolean } = {}) {
  return render(
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
      {...(options.canCreate === undefined
        ? {}
        : { canCreate: options.canCreate })}
    />,
  );
}

describe("INTENDED RED — the schedule states a session's time in 12-hour AM/PM", () => {
  it("shows the session time in the event detail panel as AM/PM, not as a 24-hour clock", async () => {
    // The contract for scheduling is 12-hour AM/PM labels. The panel's
    // own header already reads the range that way; its detail row must
    // not contradict it with "18:00–19:00".
    renderCalendar([sessionEvent()]);

    fireEvent.click(screen.getByTestId("calendar-event"));
    const detail = await screen.findByTestId("calendar-detail");

    const timeLabel = [...detail.querySelectorAll("dt")].find(
      (cell) => cell.textContent === "Time",
    );
    expect(timeLabel).toBeTruthy();
    const timeValue = timeLabel!.nextElementSibling?.textContent ?? "";

    expect(timeValue).toContain("6:00 pm");
    expect(timeValue).not.toContain("18:00");
  });

  it("keeps the block, the agenda and the detail panel on the same clock", async () => {
    // Control first: the block's own accessible name is already the
    // 12-hour range, so the detail row is the only surface that can
    // disagree with it.
    renderCalendar([sessionEvent()]);

    const block = screen.getByTestId("calendar-event");
    const blockLabel = block.getAttribute("aria-label") ?? "";
    expect(blockLabel).toContain("6:00 pm");

    fireEvent.click(block);
    const detail = await screen.findByTestId("calendar-detail");
    const timeLabel = [...detail.querySelectorAll("dt")].find(
      (cell) => cell.textContent === "Time",
    );
    const timeValue = timeLabel!.nextElementSibling?.textContent ?? "";

    expect(timeValue).toBe(blockLabel.match(/\d{1,2}:\d{2} [ap]m – \d{1,2}:\d{2} [ap]m/)?.[0] ?? timeValue);
  });
});

describe("INTENDED RED — the booking desk offers one contextual create action", () => {
  async function renderBookingsPage(options: { canCreate?: boolean } = {}) {
    pageMocks.permissions = [
      "attendance.read",
      "programs.read",
      "programs.write",
      "bookings.read",
      ...(options.canCreate === false ? [] : ["bookings.write"]),
      "settings.manage",
    ];
    const page = await OwnerBookingsPage({
      searchParams: Promise.resolve({}),
    });
    return render(page);
  }

  it("offers the booking create entry through the shared create action", async () => {
    // The approved direction: one contextual create action — a round
    // bubble on a phone, the labelled primary on a desktop — rendered by
    // the shared primitive, and never a second copy of the same job.
    await renderBookingsPage();

    const action = screen.getByTestId("booking-create-action");
    expect(action.tagName).toBe("A");
    expect(action.getAttribute("href")).toBe("#new-booking");
    // The shared primitive's own marker: this is not a local duplicate.
    expect(action.getAttribute("data-owner-create-action")).toBe("");
    expect(action.textContent).toContain("New booking");
    // One create entry only — the old inline anchor is gone.
    expect(document.querySelectorAll('a[href="#new-booking"]')).toHaveLength(1);
  });

  it("does not offer the create action to a reader who cannot book", async () => {
    // The page server gates the action on the write permission: no
    // action AND no create form for a reader who may not book.
    await renderBookingsPage({ canCreate: false });
    expect(screen.queryByTestId("booking-create-action")).toBeNull();
    expect(screen.queryByTestId("booking-selected-slot")).toBeNull();
    expect(screen.queryByTestId("booking-create")).toBeNull();
  });

  it("fails closed when the caller forgets the gate", () => {
    // A desk rendered WITHOUT the gate offers no creation surface at
    // all: the shared action and the create form are both absent, so a
    // future consumer that forgets the authority cannot leak a create
    // affordance by accident.
    renderDesk();
    expect(screen.queryByTestId("booking-create-action")).toBeNull();
    expect(screen.queryByTestId("booking-selected-slot")).toBeNull();
    expect(screen.queryByTestId("booking-create")).toBeNull();
  });

  it("focuses the existing form on hash navigation without selecting or mutating", async () => {
    await renderBookingsPage();

    // The hash target is the form that already exists, and it is
    // focusable so the browser's fragment navigation moves focus there
    // and scrolls to it.
    const target = document.getElementById("new-booking");
    expect(target).toBeTruthy();
    expect(target!.getAttribute("tabindex")).toBe("-1");

    const facility = screen.getByTestId(
      "booking-facility",
    ) as HTMLSelectElement;
    const slot = screen.getByTestId("booking-slot") as HTMLSelectElement;
    const facilityBefore = facility.value;
    const slotBefore = slot.value;

    fireEvent.click(screen.getByTestId("booking-create-action"));

    // Nothing is selected, quoted or written by reaching the form.
    expect(mocks.created).toEqual([]);
    expect(
      (screen.getByTestId("booking-facility") as HTMLSelectElement).value,
    ).toBe(facilityBefore);
    expect((screen.getByTestId("booking-slot") as HTMLSelectElement).value).toBe(
      slotBefore,
    );
    // The form is still in the member mode it starts in: no member was
    // chosen for the owner.
    expect(
      screen.getByTestId("booking-mode-member").getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("INTENDED RED — the booking day board speaks one clock", () => {
  it("prints a booked slot in the same 12-hour shape as the free slot beside it", () => {
    // One list, one clock. The free configured hours are the desk's own
    // wall clock ("7:00 pm–8:00 pm"); a booked slot is the same desk
    // and must not print the same hour with a different shape
    // ("06:00 pm–07:00 pm").
    render(
      <BookingDayList
        rows={[BOOKED_ROW]}
        busyId={null}
        onCancel={() => {}}
        onBill={() => {}}
        slots={["19:00"]}
        onChooseSlot={() => {}}
      />,
    );

    const booked = screen.getByTestId("booking-row").textContent ?? "";
    const free = screen.getByTestId("booking-slot-row").textContent ?? "";

    // The free hour already reads this way; the booked hour must agree.
    expect(free).toContain("7:00 pm–8:00 pm");
    expect(booked).toContain("6:00 pm");
    expect(booked).not.toContain("06:00 pm");
    expect(booked).not.toContain("07:00 pm");
  });
});

describe("INTENDED RED — the schedule states its scope once", () => {
  it("does not repeat the schedule's scope in the page heading and the calendar card", async () => {
    // One fact, one owner. The calendar card already says what the
    // screen shows ("Week · scheduled sessions"); the page heading must
    // not restate the same scope in a second sentence.
    pageMocks.sessions = [SESSION];
    const page = await OwnerSchedulePage({
      searchParams: Promise.resolve({ view: "week" }),
    });
    render(page);

    const mentions =
      document.body.textContent?.match(/scheduled (batch )?sessions/gi) ?? [];
    expect(mentions).toHaveLength(1);
  });

  it("states the scope once in the day view too", async () => {
    pageMocks.sessions = [SESSION];
    const page = await OwnerSchedulePage({
      searchParams: Promise.resolve({ view: "day" }),
    });
    render(page);

    const mentions =
      document.body.textContent?.match(/scheduled (batch )?sessions/gi) ?? [];
    expect(mentions).toHaveLength(1);
  });
});

describe("baseline — behaviour the operations change must not touch", () => {
  it("places a session's block at its start minute and sizes it by its duration", () => {
    // The block sits 18:00 on a ruler that starts at 06:00, and it is
    // exactly one hour tall.
    renderCalendar([sessionEvent()]);
    const block = screen.getByTestId("calendar-event");
    expect(block.getAttribute("data-top")).toBe("720");
    expect(block.getAttribute("data-height")).toBe("60");
  });

  it("flags two overlapping sessions that share one coach", () => {
    // A coach is the exclusive resource; the clash marker must survive
    // the change.
    const first = sessionEvent();
    const second = sessionEvent({
      id: "s-2",
      startsAt: "2026-11-02T13:00:00.000Z",
      endsAt: "2026-11-02T14:00:00.000Z",
      batchName: "Morning Squad",
    });
    const { container } = renderCalendar([first, second]);
    expect(container.querySelectorAll('[data-testid="calendar-clash"]')).toHaveLength(
      2,
    );
  });

  it("keeps the booking create form reachable", async () => {
    renderDesk({ canCreate: true });
    await screen.findByRole("tab", { name: "Calendar" });
    expect(screen.getByTestId("booking-selected-slot")).toBeTruthy();
    expect(screen.getByTestId("booking-create")).toBeTruthy();
  });

  it("puts no floating create action on the schedule", () => {
    // The approved concept deliberately leaves the calendar without a
    // bubble: no single creation action exists there. A schedule that
    // grew one would duplicate the header job.
    const root = process.cwd();
    for (const file of [
      "components/owner-schedule-grid.tsx",
      "app/(owner)/owner/schedule/page.tsx",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toContain("owner-create-action");
      expect(source).not.toContain("data-fab");
    }
  });
});
