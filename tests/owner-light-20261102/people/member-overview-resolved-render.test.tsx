// @vitest-environment jsdom
//
// Owner light · People lane (4 November 2026) — the member profile's resolved
// overview boundary.
//
// Bounded candidate for the confirmed normal-Chrome stall on
// directory → profile: the page must not return its JSX while the overview's
// authorized section reads are still in flight behind nested Suspense. The
// entity/auth decision stays first; the overview data is then resolved BEFORE
// the page returns, so the route's own loading boundary is the only fallback.
//
// These assertions are about the page's returned element, not its source text:
//   - a delayed overview read keeps the page promise pending;
//   - once resolved, the returned tree contains the real sections immediately,
//     with no in-page "loading member details" fallback;
//   - a rejected overview read rejects the page instead of floating;
//   - a non-overview tab never waits for, or issues, an overview read;
//   - the member entity check still happens BEFORE any overview read starts.
//
// No database: every server action is stubbed.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  getMemberDetailAction: vi.fn(),
  getMemberIdCardContextAction: vi.fn(),
  getMemberPayerAction: vi.fn(),
  listLocationsAction: vi.fn(),
  getMemberAttendanceHistoryAction: vi.fn(),
  getTerminologyAction: vi.fn(),
  getTenantTimezoneAction: vi.fn(),
  listOptedFacilitiesAction: vi.fn(),
  getNotificationDestinationsAction: vi.fn(),
  getMemberProgressAction: vi.fn(),
  readOwnerMemberInitialPanels: vi.fn(),
  hasPermission: vi.fn(),
  hasFeature: vi.fn(),
}));

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

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => router,
}));

vi.mock("@/lib/actions/people", () => ({
  getMemberDetailAction: spies.getMemberDetailAction,
  getMemberIdCardContextAction: spies.getMemberIdCardContextAction,
  getMemberPayerAction: spies.getMemberPayerAction,
  listLocationsAction: spies.listLocationsAction,
}));
vi.mock("@/lib/actions/attendance", () => ({
  getMemberAttendanceHistoryAction: spies.getMemberAttendanceHistoryAction,
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: spies.getTerminologyAction,
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: spies.getTenantTimezoneAction,
}));
vi.mock("@/lib/actions/facility-optins", () => ({
  listOptedFacilitiesAction: spies.listOptedFacilitiesAction,
}));
vi.mock("@/lib/actions/notification-destinations", () => ({
  getNotificationDestinationsAction: spies.getNotificationDestinationsAction,
}));
vi.mock("@/lib/actions/assessments", () => ({
  getMemberProgressAction: spies.getMemberProgressAction,
}));
vi.mock("@/components/member-detail/owner-member-initial-panels", () => ({
  readOwnerMemberInitialPanels: spies.readOwnerMemberInitialPanels,
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write"]),
    features: new Set(["members"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: spies.hasPermission,
  hasFeature: spies.hasFeature,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const Empty = vi.hoisted(() => () => null);
vi.mock("@/components/member-status-panel", () => ({ MemberStatusPanel: Empty }));
vi.mock("@/components/member-enrolment-panel", () => ({ MemberEnrolmentPanel: Empty }));
vi.mock("@/components/member-subscription-panel", () => ({ MemberSubscriptionPanel: Empty }));
vi.mock("@/components/member-facilities-panel", () => ({ MemberFacilitiesPanel: Empty }));
vi.mock("@/components/makeup-credits-panel", () => ({ MakeupCreditsPanel: Empty }));
vi.mock("@/components/parent-link-panel", () => ({ ParentLinkPanel: Empty }));
vi.mock("@/components/member-id-card", () => ({ MemberIdCard: Empty }));
vi.mock("@/components/member-notification-destinations", () => ({
  MemberNotificationDestinations: Empty,
}));
vi.mock("@/components/member-detail/member-profile-sections", () => ({
  MemberProfileSections: Empty,
}));
vi.mock("@/components/member-detail/member-attendance-grid", () => ({
  MemberAttendanceGrid: Empty,
}));
vi.mock("@/components/member-detail/member-invoices-panel", () => ({
  MemberInvoicesPanel: () => <div data-testid="panel-payments" />,
}));
vi.mock("@/components/member-detail/member-progress-panel", () => ({
  MemberProgressPanel: () => <div data-testid="panel-progress" />,
}));
vi.mock("@/components/member-detail/member-notes-panel", () => ({
  MemberNotesPanel: () => <div data-testid="panel-notes" />,
}));
vi.mock("@/components/member-detail/member-documents-panel", () => ({
  MemberDocumentsPanel: () => <div data-testid="panel-documents" />,
}));
vi.mock("@/components/member-detail/inline-edit-field", () => ({
  InlineEditField: ({ value }: { value: string }) => <>{value}</>,
}));

import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const FACILITY = "22222222-2222-4222-8222-222222222222";

const MEMBER = {
  memberId: MEMBER_ID,
  fullName: "Aaradhya Iyer",
  phone: "+919812340099",
  memberCode: "M-01",
  locationId: FACILITY,
  locationName: "Worli Main",
  isMinor: false,
  status: "active",
  joinedOn: "2026-10-10",
  dateOfBirth: "2015-01-01",
  gender: null,
  medicalNotes: null,
  guardians: [],
  consents: [],
  statusHistory: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Resolve after the page's microtasks have had a chance to run. */
async function settledWithin<T>(promise: Promise<T>): Promise<"resolved" | "pending"> {
  return Promise.race([
    promise.then(() => "resolved" as const, () => "resolved" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
  ]);
}

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockReset();
  spies.getMemberDetailAction.mockResolvedValue(MEMBER);
  spies.getMemberIdCardContextAction.mockResolvedValue(null);
  spies.getMemberPayerAction.mockResolvedValue(null);
  spies.listLocationsAction.mockResolvedValue([]);
  spies.getMemberAttendanceHistoryAction.mockResolvedValue({
    rows: [],
    today: "2026-11-03",
  });
  spies.getTerminologyAction.mockResolvedValue({ locale: "en", overrides: {} });
  spies.getTenantTimezoneAction.mockResolvedValue("Asia/Kolkata");
  spies.listOptedFacilitiesAction.mockResolvedValue([]);
  spies.getNotificationDestinationsAction.mockResolvedValue(null);
  spies.getMemberProgressAction.mockResolvedValue(null);
  spies.readOwnerMemberInitialPanels.mockResolvedValue({
    enrolment: { memberId: MEMBER_ID, failed: true },
    subscription: { memberId: MEMBER_ID, failed: true },
    makeup: { memberId: MEMBER_ID, failed: true },
  });
  spies.hasPermission.mockReturnValue(true);
  spies.hasFeature.mockReturnValue(false);
});

afterEach(cleanup);

function pageFor(tab?: string) {
  return MemberDetailPage({
    params: Promise.resolve({ memberId: MEMBER_ID }),
    searchParams: Promise.resolve(
      tab ? { facility: FACILITY, tab } : { facility: FACILITY },
    ),
  });
}

describe("the overview's resolved-data boundary", () => {
  // INTENDED RED: the page returned its JSX immediately and left the delayed
  // attendance read to an async child behind Suspense.
  it("does not return its JSX before the overview attendance read resolves", async () => {
    const pending = deferred<{ rows: []; today: string }>();
    spies.getMemberAttendanceHistoryAction.mockReturnValue(pending.promise);
    const page = pageFor();
    expect(await settledWithin(page)).toBe("pending");
    pending.resolve({ rows: [], today: "2026-11-03" });
    await act(async () => {
      render(await page);
    });
  });

  it("renders the real overview sections immediately once the data resolves", async () => {
    const pending = deferred<{ rows: []; today: string }>();
    spies.getMemberAttendanceHistoryAction.mockReturnValue(pending.promise);
    const page = pageFor();
    pending.resolve({ rows: [], today: "2026-11-03" });
    await act(async () => {
      render(await page);
    });
    expect(screen.getByText("Participation & enrolment")).toBeTruthy();
    expect(screen.getByText("Contacts & consent")).toBeTruthy();
    expect(screen.getByText("Attendance evidence")).toBeTruthy();
    // The route boundary owns the fallback; the returned tree must not paint an
    // in-page skeleton after its own data was awaited.
    expect(screen.queryByText(/loading member details/i)).toBeNull();
  });

  // GUARD: a rejected authorized read is an error, never silently hidden.
  it("rejects when an overview read rejects", async () => {
    spies.getMemberAttendanceHistoryAction.mockRejectedValue(
      new Error("attendance history refused"),
    );
    await expect(pageFor()).rejects.toThrow("attendance history refused");
  });
});

describe("the non-overview tabs keep their own boundary", () => {
  // CONTROL: Notes never waits for the overview read and never issues it.
  it("returns immediately and issues no overview read on the notes tab", async () => {
    spies.getMemberAttendanceHistoryAction.mockReturnValue(new Promise(() => {}));
    const page = pageFor("notes");
    expect(await settledWithin(page)).toBe("resolved");
    render(await page);
    expect(screen.getByTestId("panel-notes")).toBeTruthy();
    expect(spies.getMemberAttendanceHistoryAction).not.toHaveBeenCalled();
    expect(spies.readOwnerMemberInitialPanels).not.toHaveBeenCalled();
    expect(spies.getNotificationDestinationsAction).not.toHaveBeenCalled();
  });
});

describe("the entity check still precedes the overview reads", () => {
  // GUARD: while the member read is unresolved, no overview read is started.
  it("starts no overview read until the member is known", async () => {
    const pending = deferred<typeof MEMBER>();
    spies.getMemberDetailAction.mockReturnValue(pending.promise);
    const page = pageFor();
    expect(await settledWithin(page)).toBe("pending");
    expect(spies.getMemberAttendanceHistoryAction).not.toHaveBeenCalled();
    expect(spies.readOwnerMemberInitialPanels).not.toHaveBeenCalled();
    pending.resolve(MEMBER);
    await act(async () => {
      await page;
    });
  });
});
