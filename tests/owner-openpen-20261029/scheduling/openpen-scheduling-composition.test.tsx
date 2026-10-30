// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen — scheduling lane acceptance (29 October 2026).
//
// These cases pin the OBSERVABLE composition of the assigned routes
// against the reference, using real component props and real rendered
// text/roles. They are deliberately not class-string assertions:
//
//   Programs: the batch catalogue is an aligned table with recurrence,
//   time, coach and places columns, not one prose line per batch.
//   Batch: the waitlist is an ordered queue surface with request dates.
//   Schedule: the toolbar offers exception management as a destination.
//   Sessions: each row states its lifecycle, and Manage selects one
//   session into a bounded editor rather than expanding everything.
//   Bookings: the day board and the selected slot are named surfaces.
//   Onboarding: completion is a check-count surface, not a hero.
//
// The acceptance test path is fixed for the lane's RED/GREEN log:
// tests/owner-openpen-20261029/scheduling/openpen-scheduling-composition.test.tsx

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/actions/programs", () => ({
  createProgramAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  updateProgramAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  deleteProgramAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  deleteBatchAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  createBatchAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  updateBatchAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  listBatchesAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: async () => ({ conflicts: [] }),
}));
vi.mock("@/lib/actions/bookings", () => ({
  listBookingsAction: async () => [],
  cancelBookingAction: async () => ({ ok: true as const }),
  requestBookingBillAction: async () => ({
    ok: false as const,
    error: "No bill raised in this test.",
  }),
  quoteBookingAction: async () => ({ ok: true as const, pricePaise: 50000 }),
}));
vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));
vi.mock("@/components/session-substitute-control", () => ({
  SessionSubstituteControl: () => <div data-testid="substitute-control" />,
}));
vi.mock("@/components/session-lifecycle-control", () => ({
  SessionLifecycleControl: () => <div data-testid="lifecycle-control" />,
}));
vi.mock("@/lib/actions/waitlist", () => ({
  promoteHeadAction: vi.fn(async () => ({ kind: "ok" as const })),
  cancelWaitlistAction: vi.fn(async () => ({ kind: "ok" as const })),
  listWaitlistAction: vi.fn(async () => []),
}));
vi.mock("@/lib/auth/surface-guard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/surface-guard")>();
  return {
    ...actual,
    requireOwner: async () => ({
      tenantId: "t-1",
      userId: "u-1",
      permissions: new Set(["programs.read"]),
    }),
  };
});
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({
    tenantId: "t-1",
    userId: "u-1",
    permissions: new Set(["programs.read"]),
  }),
}));
vi.mock("@/db/tenant", () => ({
  withTenant: async (
    _tenantId: string,
    fn: (tx: unknown) => Promise<unknown>,
  ) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ timezone: "Asia/Kolkata" }],
          }),
        }),
      }),
    }),
}));
vi.mock("@/lib/services/attendance-history", () => ({
  currentMonthPeriod: () => ({ from: "2026-10-01", to: "2026-10-31" }),
  getBatchAttendanceSummary: async () => ({
    batchId: "b-1",
    batchName: "Morning Squad",
    sessionCount: 12,
    presentMarks: 69,
    totalMarks: 84,
    pct: 82,
  }),
}));

import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { WaitlistBoard } from "@/components/waitlist-board";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";
import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
import { BookingScreen } from "@/components/booking-screen";
import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import BatchDetailPage from "@/app/(owner)/owner/batches/[batchId]/page";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { UpcomingSessionRow } from "@/lib/services/coach-schedule";
import type { TerminologyState } from "@/lib/terminology/keys";
import { formatWallTime12h } from "@/lib/time/tz";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

const PROGRAM = {
  id: "p-1",
  tenantId: "t-1",
  name: "Learn to swim",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
} as unknown as Program;

const BATCH: BatchWithProgramName = {
  id: "b-1",
  tenantId: "t-1",
  programId: "p-1",
  name: "Morning Squad",
  capacity: 12,
  daysOfWeek: [1, 3, 5],
  startTime: "06:00:00",
  endTime: "07:00:00",
  coachId: null,
  locationId: "loc-1",
  programName: "Learn to swim",
  coachName: "Aanya Rao",
  locationName: "Worli Main",
} as unknown as BatchWithProgramName;

function session(overrides: Partial<UpcomingSessionRow> = {}): UpcomingSessionRow {
  return {
    id: "s-1",
    sessionDate: "2026-10-27",
    startsAt: new Date("2026-10-27T00:30:00.000Z"),
    endsAt: new Date("2026-10-27T01:30:00.000Z"),
    batchId: "b-1",
    batchName: "Morning Squad",
    coachId: "c-1",
    coachName: "Aanya Rao",
    status: "scheduled",
    ...overrides,
  };
}

afterEach(cleanup);

describe("OpenPen programs composition", () => {
  it("shows the batch catalogue as an aligned table, not a prose line", () => {
    render(
      <ProgramsBatchesBoard
        initialPrograms={[PROGRAM]}
        initialBatches={[BATCH]}
        coaches={[]}
        locations={[]}
        terminology={TERMINOLOGY}
      />,
    );
    for (const heading of ["Days", "Time", "Coach", "Places"]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeTruthy();
    }
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Mon · Wed · Fri")).toBeTruthy();
    expect(table.getByText(`${formatWallTime12h("06:00")}–${formatWallTime12h("07:00")}`)).toBeTruthy();
    expect(table.getByText("12")).toBeTruthy();
  });

  it("keeps the add-program action above the batch catalogue", () => {
    render(
      <ProgramsBatchesBoard
        initialPrograms={[PROGRAM]}
        initialBatches={[BATCH]}
        coaches={[]}
        locations={[]}
        terminology={TERMINOLOGY}
      />,
    );
    const add = screen.getByRole("button", { name: "Add program" });
    const catalogue = screen.getByRole("heading", { name: /Recurring batches/ });
    expect(
      add.compareDocumentPosition(catalogue) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("OpenPen batch waitlist composition", () => {
  it("keeps the queue ordered and states when each request arrived", () => {
    render(
      <WaitlistBoard
        batchId="b-1"
        canManage
        initialRows={[
          {
            entryId: "w-1",
            memberId: "m-1",
            memberName: "Kabir Menon",
            memberCode: "SSC-005",
            position: 1,
            requestedAt: new Date("2026-10-22T04:30:00.000Z"),
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Waitlist in order" })).toBeTruthy();
    expect(document.body.textContent).toContain("#1");
    expect(document.body.textContent).toContain("Requested 22 Oct 2026");
  });
});

describe("OpenPen schedule composition", () => {
  it("offers exception management beside the calendar navigation", () => {
    render(
      <OwnerScheduleGrid
        view="week"
        locations={[]}
        sessions={[]}
        days={["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]}
        monthCells={null}
        prevHref="/owner/schedule"
        nextHref="/owner/schedule"
        todayHref="/owner/schedule"
        canManagePrograms
      />,
    );
    const action = screen.getByRole("link", { name: /Manage session exceptions/i });
    expect(action.getAttribute("href")).toBe("/owner/sessions");
    expect(screen.getByRole("heading", { name: /scheduled sessions/i })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Previous week" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Next week" })).toBeTruthy();
  });
});

describe("OpenPen sessions composition", () => {
  it("states each row's lifecycle and selects one into a bounded editor", () => {
    render(
      <UpcomingSessionsList
        canManage
        initialSessions={[session()]}
        coaches={[]}
        terminology={TERMINOLOGY}
      />,
    );
    expect(screen.getAllByText("Scheduled").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("columnheader", { name: "Session" }),
    ).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Coach" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "State" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    expect(
      screen.getByRole("heading", { name: /Selected session · Morning Squad/i }),
    ).toBeTruthy();
    expect(screen.getByTestId("substitute-control")).toBeTruthy();
    expect(screen.getByTestId("lifecycle-control")).toBeTruthy();
  });
});

describe("OpenPen bookings composition", () => {
  it("names the day board and the selected slot as separate surfaces", async () => {
    render(
      <BookingScreen
        facilities={[
          {
            id: "f-1",
            name: "Main court",
            kind: "court",
            capacity: 4,
            locationId: "loc-1",
            locationName: "Worli Main",
            subUnits: [],
          },
        ]}
        timezone="Asia/Kolkata"
        today="2026-10-27"
        terminology={TERMINOLOGY}
      />,
    );
    expect(screen.getByRole("heading", { name: "Day board" })).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "Selected slot" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Confirm booking/ }),
    ).toBeTruthy();
  });

  it("offers the day's real slots and moves the chosen one into the selected slot", async () => {
    render(
      <BookingScreen
        facilities={[
          {
            id: "f-1",
            name: "Main court",
            kind: "court",
            capacity: 4,
            locationId: "loc-1",
            locationName: "Worli Main",
            subUnits: [],
          },
        ]}
        timezone="Asia/Kolkata"
        today="2026-10-27"
        terminology={TERMINOLOGY}
      />,
    );
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    const choices = await screen.findAllByRole("button", {
      name: "Choose slot",
    });
    expect(choices.length).toBeGreaterThan(0);
    fireEvent.click(choices[0]!);
    const slot = screen.getByTestId("booking-slot") as HTMLSelectElement;
    expect(slot.value).toBe("06:00");
  });
});

describe("OpenPen batch detail composition", () => {
  it("places compact attendance evidence beside the ordered waitlist", async () => {
    render(
      await BatchDetailPage({
        params: Promise.resolve({ batchId: "b-1" }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "October attendance" }),
    ).toBeTruthy();
    expect(screen.getByText("82%")).toBeTruthy();
    expect(screen.getByText("69 Present or Late out of 84 recorded marks.")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Waitlist in order" }),
    ).toBeTruthy();
  });
});

describe("OpenPen onboarding composition", () => {
  it("leads with the register check count and one next task", () => {
    render(
      <OnboardingChecklistView
        data={{
          completedCount: 1,
          totalCount: 3,
          items: [
            {
              key: "add_members",
              title: "Add your first member",
              detail: "The register starts with members.",
              cta: { label: "Add a member", href: "/owner/members/new" },
              complete: true,
            },
            {
              key: "create_batch",
              title: "Create a recurring batch",
              detail: "Batches generate the sessions.",
              cta: { label: "Create batch", href: "/owner/programs" },
              complete: false,
            },
            {
              key: "assign_coach",
              title: "Assign a coach",
              detail: "A coach is needed for the register.",
              cta: { label: "Assign a coach", href: "/owner/programs" },
              complete: false,
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Set up your first register" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "1 of 3 checks complete" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Create batch/i })).toBeTruthy();
    expect(screen.getByText("Next step")).toBeTruthy();
  });
});
