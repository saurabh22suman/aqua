// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the member profile's
// overview-only reads stay on the overview tab.
//
// CONFIRMED source defect (independent of the unresolved navigation cause):
// `app/(owner)/owner/members/[memberId]/page.tsx` built its `overviewReads`
// object UNCONDITIONALLY, so every tab — notes, payments, progress,
// documents — issued the four overview-section reads
// (`getMemberAttendanceHistoryAction`, `getMemberIdCardContextAction`,
// `listOptedFacilitiesAction`, `listLocationsAction`). Those tabs never
// consume those promises: unnecessary authenticated I/O, and a floating
// rejection that nobody awaits.
//
// This file is NOT a claim about the navigation stall. The direct-flow
// isolation runs (PROFILE → Notes failed 2/2) remain unexplained; this file
// pins the read-scope contract only.
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

// The four reads that belong to the overview sections alone.
const OVERVIEW_ONLY = [
  ["getMemberAttendanceHistoryAction", spies.getMemberAttendanceHistoryAction],
  ["getMemberIdCardContextAction", spies.getMemberIdCardContextAction],
  ["listOptedFacilitiesAction", spies.listOptedFacilitiesAction],
  ["listLocationsAction", spies.listLocationsAction],
] as const;

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

// The profile's heavy panels are stubbed; the PAGE's own read composition is
// what this file observes.
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
// The tab panels announce WHICH panel is live.
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
  // The owner sees every panel; the accountant branch (invoices.read without
  // attendance.read) must not be taken.
  spies.hasPermission.mockReturnValue(true);
  spies.hasFeature.mockReturnValue(false);
});

afterEach(cleanup);

async function renderPage(tab?: string) {
  const page = await MemberDetailPage({
    params: Promise.resolve({ memberId: MEMBER_ID }),
    searchParams: Promise.resolve(
      tab ? { facility: FACILITY, tab } : { facility: FACILITY },
    ),
  });
  await act(async () => {
    render(page);
  });
}

describe("a non-overview tab issues no overview-section read", () => {
  const TABS = [
    { tab: "notes", panel: "panel-notes" },
    { tab: "payments", panel: "panel-payments" },
    { tab: "documents", panel: "panel-documents" },
    { tab: "progress", panel: "panel-progress" },
  ] as const;

  for (const { tab, panel } of TABS) {
    // INTENDED RED: the page's `overviewReads` object was built for EVERY
    // tab, so the four overview-section reads were issued and never
    // consumed.
    it(`issues none of the four overview reads on the ${tab} tab`, async () => {
      await renderPage(tab);
      for (const [name, spy] of OVERVIEW_ONLY) {
        expect(spy, name).not.toHaveBeenCalled();
      }
    });

    // CONTROL: the tab still reads what it actually renders.
    it(`keeps its own reads and its own panel on the ${tab} tab`, async () => {
      await renderPage(tab);
      expect(spies.getMemberDetailAction).toHaveBeenCalledWith(MEMBER_ID);
      expect(spies.getTerminologyAction).toHaveBeenCalled();
      expect(spies.getTenantTimezoneAction).toHaveBeenCalled();
      expect(screen.getByTestId(panel)).toBeTruthy();
      // The overview subtree is not on this tab.
      expect(screen.queryByText("Participation & enrolment")).toBeNull();
      expect(screen.queryByText("Contacts & consent")).toBeNull();
      expect(screen.queryByText("Attendance evidence")).toBeNull();
      // The overview's own panel/destination reads stay off too.
      expect(spies.readOwnerMemberInitialPanels).not.toHaveBeenCalled();
      expect(spies.getNotificationDestinationsAction).not.toHaveBeenCalled();
    });
  }
});

describe("the overview tab keeps its own reads", () => {
  // CONTROL: the four overview reads still happen, exactly once each.
  it("calls the four overview reads exactly once on the overview tab", async () => {
    await renderPage();
    expect(spies.getMemberAttendanceHistoryAction).toHaveBeenCalledTimes(1);
    expect(spies.getMemberAttendanceHistoryAction).toHaveBeenCalledWith(MEMBER_ID);
    expect(spies.getMemberIdCardContextAction).toHaveBeenCalledTimes(1);
    expect(spies.listOptedFacilitiesAction).toHaveBeenCalledTimes(1);
    expect(spies.listOptedFacilitiesAction).toHaveBeenCalledWith(MEMBER_ID);
    expect(spies.listLocationsAction).toHaveBeenCalledTimes(1);
  });

  // CONTROL: the existing panel and destination reads are untouched.
  it("keeps the existing panel and destination reads on the overview tab", async () => {
    await renderPage();
    expect(spies.readOwnerMemberInitialPanels).toHaveBeenCalledTimes(1);
    expect(spies.readOwnerMemberInitialPanels).toHaveBeenCalledWith(MEMBER_ID);
    expect(spies.getNotificationDestinationsAction).toHaveBeenCalledTimes(1);
    expect(spies.getNotificationDestinationsAction).toHaveBeenCalledWith(MEMBER_ID);
  });

  // CONTROL: the overview's visible behaviour is unchanged.
  it("still shows the overview sections, the header and the tabs", async () => {
    await renderPage();
    expect(screen.getByText("Participation & enrolment")).toBeTruthy();
    expect(screen.getByText("Contacts & consent")).toBeTruthy();
    expect(screen.getByText("Attendance evidence")).toBeTruthy();
    expect(screen.getByText(/Other .* tools/)).toBeTruthy();
    expect(screen.getByText("Aaradhya Iyer")).toBeTruthy();
    expect(screen.getByText(/M-01/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Payments" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=payments&facility=${FACILITY}`,
    );
  });
});

describe("the progress tab's own conditional is unchanged", () => {
  // CONTROL: with the ladder module on, the progress tab still reads the
  // member's progress — and only the overview reads stay off.
  it("reads the member's progress on the progress tab when the module is on", async () => {
    spies.hasFeature.mockReturnValue(true);
    await renderPage("progress");
    expect(spies.getMemberProgressAction).toHaveBeenCalledTimes(1);
    expect(spies.getMemberProgressAction).toHaveBeenCalledWith(MEMBER_ID);
    for (const [, spy] of OVERVIEW_ONLY) expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId("panel-progress")).toBeTruthy();
  });

  // GUARD: with the module off, no progress read is issued.
  it("does not read the member's progress when the module is off", async () => {
    await renderPage("progress");
    expect(spies.getMemberProgressAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("panel-progress")).toBeTruthy();
  });
});

describe("the member guard starts no section read", () => {
  // GUARD: a missing member is a 404 and starts no section read.
  it("starts no section read for a missing member", async () => {
    spies.getMemberDetailAction.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    for (const [name, spy] of OVERVIEW_ONLY) {
      expect(spy, name).not.toHaveBeenCalled();
    }
    expect(spies.readOwnerMemberInitialPanels).not.toHaveBeenCalled();
    expect(spies.getNotificationDestinationsAction).not.toHaveBeenCalled();
  });

  // GUARD: a rejected member read starts no section read either.
  it("starts no section read when the member read is rejected", async () => {
    spies.getMemberDetailAction.mockRejectedValue(new Error("member read refused"));
    await expect(renderPage()).rejects.toThrow("member read refused");
    for (const [name, spy] of OVERVIEW_ONLY) {
      expect(spy, name).not.toHaveBeenCalled();
    }
    expect(spies.readOwnerMemberInitialPanels).not.toHaveBeenCalled();
    expect(spies.getNotificationDestinationsAction).not.toHaveBeenCalled();
  });
});

describe("a non-overview tab leaves no floating rejection", () => {
  // INTENDED RED: the overview-only read was issued and never awaited on a
  // tab that does not consume it, so its rejection had no owner.
  it("does not issue an overview-only read that can reject unnoticed", async () => {
    spies.getMemberAttendanceHistoryAction.mockRejectedValue(
      new Error("attendance history refused"),
    );
    await renderPage("notes");
    expect(screen.getByTestId("panel-notes")).toBeTruthy();
    expect(spies.getMemberAttendanceHistoryAction).not.toHaveBeenCalled();
  });
});
