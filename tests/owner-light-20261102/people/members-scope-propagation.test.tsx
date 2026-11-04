// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the drill-down keeps the
// directory's scope.
//
// CONFIRMED production Chrome failure (owner-light-full-review-r1): the
// in-app "Members" return lost the search because the PROFILE URL carried
// no `?facility=`. The facility switcher then saw a missing query plus a
// remembered facility cookie and normalised the URL with
// `window.location.replace` — a hard reload that erased the in-memory
// return intent (the Back link fell back to the plain "/owner/members").
//
// The scope must therefore travel with every drill-down: the member row,
// and the member's own tabs. The scope is the directory's existing,
// server-derived scope — the canonical selected UUID, or an EXPLICIT
// "all" so a stale cookie can never override the all-facilities view.
//
// No search term, name, phone or status ever travels in the URL, and no
// grant, access rule or data read changes.
//
// No database: every server action is stubbed.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());
const getTerminologyAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// next/link needs an App Router context; the links are asserted by
// their destination, so they render as plain anchors here.
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

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
  getMemberDetailAction: async () => ({
    memberId: "11111111-1111-4111-8111-111111111111",
    fullName: "Aaradhya Iyer",
    phone: "+919812340099",
    memberCode: "M-01",
    locationId: "22222222-2222-4222-8222-222222222222",
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
  }),
  getMemberIdCardContextAction: async () => null,
  getMemberPayerAction: async () => null,
  listLocationsAction: async () => [
    { id: "22222222-2222-4222-8222-222222222222", name: "Worli Main" },
  ],
}));

vi.mock("@/lib/actions/attendance", () => ({
  getMemberAttendanceHistoryAction: async () => ({ rows: [], today: "2026-11-02" }),
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: (...args: unknown[]) => getTerminologyAction(...args),
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/lib/actions/facility-optins", () => ({
  listOptedFacilitiesAction: async () => [],
}));

vi.mock("@/lib/actions/notification-destinations", () => ({
  getNotificationDestinationsAction: async () => null,
}));

vi.mock("@/lib/actions/assessments", () => ({
  getMemberProgressAction: async () => null,
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
  hasPermission: () => false,
  hasFeature: () => false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// The profile's heavy panels are stubbed; its TABS are not, so the
// scope they carry is the real one.
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
  MemberInvoicesPanel: Empty,
}));
vi.mock("@/components/member-detail/member-progress-panel", () => ({
  MemberProgressPanel: Empty,
}));
vi.mock("@/components/member-detail/member-notes-panel", () => ({
  MemberNotesPanel: Empty,
}));
vi.mock("@/components/member-detail/member-documents-panel", () => ({
  MemberDocumentsPanel: Empty,
}));
vi.mock("@/components/member-detail/inline-edit-field", () => ({
  InlineEditField: ({ value }: { value: string }) => <>{value}</>,
}));

import MembersPage from "@/app/(owner)/owner/members/page";
import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
import { MembersBoard } from "@/components/members-board";
import { MemberDetailTabs } from "@/components/member-detail/member-detail-tabs";
import type { MemberListRow } from "@/lib/services/people";

const FACILITY = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";

const ROW: MemberListRow = {
  memberId: MEMBER_ID,
  personId: "p1",
  fullName: "Aaradhya Iyer",
  phone: "+919812340099",
  memberCode: "M-01",
  status: "active",
  locationId: FACILITY,
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([ROW]);
  getTerminologyAction.mockReset();
  getTerminologyAction.mockResolvedValue({ locale: "en", overrides: {} });
});

afterEach(() => {
  cleanup();
});

describe("the member drill-down keeps the directory's scope", () => {
  // RED: the row's link carries no scope, so the profile URL is missing
  // the query the facility switcher needs to leave the URL alone.
  it("carries the selected facility on the member row", () => {
    render(
      <MembersBoard
        initialMembers={[ROW]}
        initialLocationId={FACILITY}
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const row = screen.getByTestId("member-row");
    expect(row.getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?facility=${FACILITY}`,
    );
  });

  // RED: an all-facilities directory must say so explicitly, or a
  // remembered facility cookie would narrow it on the next render.
  it("states an explicit all-facilities scope on the member row", () => {
    render(
      <MembersBoard
        initialMembers={[ROW]}
        initialLocationId=""
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const row = screen.getByTestId("member-row");
    expect(row.getAttribute("href")).toBe(`/owner/members/${MEMBER_ID}?facility=all`);
  });

  // CONTROL: the scope is the only thing in the URL — no filter, name,
  // phone or status, and the member's own id is untouched.
  it("carries the scope and nothing else", () => {
    render(
      <MembersBoard
        initialMembers={[ROW]}
        initialLocationId={FACILITY}
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const href = screen.getByTestId("member-row").getAttribute("href") ?? "";
    const query = href.split("?")[1] ?? "";
    expect(query).toBe(`facility=${FACILITY}`);
    expect(href).toContain(MEMBER_ID);
    expect(href).not.toMatch(/search|status|phone|q=/i);
  });

  // RED: the member's own tabs must stay in the same scope, or every tab
  // click normalises the URL and reloads the page.
  it("keeps the facility scope on the member tabs", () => {
    render(
      <MemberDetailTabs
        memberId={MEMBER_ID}
        active="overview"
        facilityScope={FACILITY}
      />,
    );
    const payments = screen.getByRole("link", { name: "Payments" });
    expect(payments.getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=payments&facility=${FACILITY}`,
    );
    expect(screen.getByRole("link", { name: "Notes" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=notes&facility=${FACILITY}`,
    );
  });

  // RED: the all-facilities scope is explicit in the tabs too.
  it("states an explicit all-facilities scope on the member tabs", () => {
    render(
      <MemberDetailTabs memberId={MEMBER_ID} active="overview" facilityScope="all" />,
    );
    expect(screen.getByRole("link", { name: "Payments" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=payments&facility=all`,
    );
  });

  // CONTROL: a consumer that has no scope keeps its own plain links.
  it("leaves a consumer without a scope unchanged", () => {
    render(<MemberDetailTabs memberId={MEMBER_ID} active="overview" />);
    expect(screen.getByRole("link", { name: "Payments" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=payments`,
    );
  });
});

describe("the scoped directory's drill-downs", () => {
  // RED: from a scoped directory EVERY member link must carry the scope,
  // so no drill-down can land on a URL that is missing the query.
  it("gives every member link the scope", async () => {
    const page = await MembersPage({
      searchParams: Promise.resolve({ facility: FACILITY }),
    });
    await act(async () => {
      render(page);
    });
    const rows = screen.getAllByTestId("member-row");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("href")).toBe(
        `/owner/members/${MEMBER_ID}?facility=${FACILITY}`,
      );
    }
  });
});

describe("the member profile keeps the scope", () => {
  // RED: the profile's tabs are a drill-down; without the scope the URL
  // loses the query and the page is hard-reloaded.
  it("keeps the facility from the URL in the member tabs", async () => {
    render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({ facility: FACILITY }),
      }),
    );
    expect(screen.getByRole("link", { name: "Payments" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=payments&facility=${FACILITY}`,
    );
    expect(screen.getByRole("link", { name: "Documents" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=documents&facility=${FACILITY}`,
    );
  });

  // RED: an explicit all-facilities scope stays explicit.
  it("keeps an explicit all-facilities scope in the member tabs", async () => {
    render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({ facility: "all" }),
      }),
    );
    expect(screen.getByRole("link", { name: "Payments" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?tab=payments&facility=all`,
    );
  });
});
