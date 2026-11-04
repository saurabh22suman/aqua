// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026; profile contract revised
// 4 November 2026) — the members boundary relocation (candidate; see
// MEMBERS-BOUNDARY-CANDIDATE.md).
//
// The experiment: the nearest segment loading boundary
// (`app/(owner)/owner/members/loading.tsx`) is removed and each member page
// owns its fallback behind an in-page Suspense boundary. These regressions pin
// what must stay true for that to be safe:
//
//   1. the DIRECTORY still returns its shell BEFORE its data section resolves,
//      so the in-page fallback is real and the route no longer depends on an
//      ancestor boundary;
//   2. the authorization and entity checks still run BEFORE any fallback is
//      returned — a missing member must not paint a skeleton, and a caller
//      without the permission must be refused.
//
// 4 November 2026: the PROFILE no longer streams its overview behind an
// in-page boundary. The normal directory → profile soft navigation stalled
// intermittently, so the page now resolves its authorized overview reads before
// returning JSX and the route-level `[memberId]/loading.tsx` carries the
// transition fallback (its shape is asserted in members-sibling-loading).
// The profile block below pins the resolved contract instead.
//
// They do not, and cannot, establish navigation timing: only a rebuilt normal
// Chrome run can do that.
//
// No database: every action is stubbed.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());
const getMemberDetailAction = vi.hoisted(() => vi.fn());
const listLocationsAction = vi.hoisted(() => vi.fn());
const getTerminologyAction = vi.hoisted(() => vi.fn());
const attendance = vi.hoisted(() => vi.fn());
const guard = vi.hoisted(() => ({ permissions: new Set<string>(["members.read", "members.write"]) }));

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
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: guard.permissions,
    features: new Set(["members"]),
  }),
  requirePagePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new Error(`forbidden: ${key}`);
    return ctx;
  },
}));

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (ctx: { permissions: Set<string> }, key: string) =>
    ctx.permissions.has(key),
  hasFeature: () => false,
}));

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
  getMemberDetailAction: (...args: unknown[]) => getMemberDetailAction(...args),
  listLocationsAction: (...args: unknown[]) => listLocationsAction(...args),
  searchPersonsAction: vi.fn(async () => []),
  getMemberIdCardContextAction: async () => null,
  getMemberPayerAction: async () => null,
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: (...args: unknown[]) => getTerminologyAction(...args),
}));

vi.mock("@/lib/actions/attendance", () => ({
  getMemberAttendanceHistoryAction: (...args: unknown[]) => attendance(...args),
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

vi.mock("@/components/member-detail/owner-member-initial-panels", () => ({
  readOwnerMemberInitialPanels: async () => null,
}));

vi.mock("@/lib/actions/assessments", () => ({
  getMemberProgressAction: async () => null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// The profile's heavy panels are not under test here; they must not fetch.
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
import EditMemberPage from "@/app/(owner)/owner/members/[memberId]/edit/page";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const FACILITY = "22222222-2222-4222-8222-222222222222";

const MEMBER = {
  memberId: MEMBER_ID,
  fullName: "Aanya Rao",
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
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Resolve after the page's microtasks have had a chance to run. */
async function settledWithin<T>(promise: Promise<T>): Promise<"resolved" | "pending"> {
  return Promise.race([
    promise.then(() => "resolved" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
  ]);
}

beforeEach(() => {
  guard.permissions = new Set(["members.read", "members.write"]);
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([]);
  getMemberDetailAction.mockReset();
  getMemberDetailAction.mockResolvedValue(MEMBER);
  listLocationsAction.mockReset();
  listLocationsAction.mockResolvedValue([{ id: FACILITY, name: "Worli Main" }]);
  getTerminologyAction.mockReset();
  getTerminologyAction.mockResolvedValue({ locale: "en", overrides: {} });
  attendance.mockReset();
  attendance.mockResolvedValue({ rows: [], today: "2026-11-03" });
});

afterEach(cleanup);

describe("the members directory's own boundary", () => {
  // RED: the page currently awaits the directory read, so it returns nothing
  // until the data arrives and there is no in-page fallback.
  it("returns its shell before the directory read resolves", async () => {
    const pending = deferred<never[]>();
    listMembersAction.mockReturnValue(pending.promise);
    const page = MembersPage({ searchParams: Promise.resolve({}) });
    try {
      expect(await settledWithin(page)).toBe("resolved");
      render(await page);
      const fallback = screen.getByTestId("members-list-loading");
      expect(fallback.getAttribute("aria-busy")).toBe("true");
    } finally {
      pending.resolve([]);
      await act(async () => {});
    }
  });

  // CONTROL: the permission is checked before anything is read or painted.
  it("refuses the directory without members.read", async () => {
    guard.permissions = new Set(["members.write"]);
    await expect(MembersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /forbidden: members\.read/,
    );
    expect(listMembersAction).not.toHaveBeenCalled();
  });
});

describe("the member profile's own boundary", () => {
  // REVISED (4 November 2026): the page resolves the overview's authorized
  // reads before it returns JSX, so a delayed section read keeps the page
  // pending. The route loading.tsx owns the transition fallback.
  it("does not return its JSX while an overview read is pending", async () => {
    attendance.mockReturnValue(new Promise(() => {}));
    const page = MemberDetailPage({
      params: Promise.resolve({ memberId: MEMBER_ID }),
      searchParams: Promise.resolve({}),
    });
    expect(await settledWithin(page)).toBe("pending");
  });

  // CONTROL: the resolved page renders the real sections and no in-page
  // loading status, and it must never look like the directory.
  it("renders the resolved sections without an in-page fallback", async () => {
    const view = render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText("Participation & enrolment")).toBeTruthy();
    expect(screen.getByText("Contacts & consent")).toBeTruthy();
    expect(screen.getByText("Attendance evidence")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("heading", { name: /Aanya Rao/ })).toHaveLength(1);
    expect(view.queryByTestId("members-list")).toBeNull();
  });

  // CONTROL: a missing member is decided BEFORE any fallback is returned.
  it("refuses a missing member before painting a fallback", async () => {
    getMemberDetailAction.mockResolvedValue(null);
    await expect(
      MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // CONTROL: while the member read itself is unresolved there is no fallback
  // yet — the entity check owns that decision.
  it("waits for the member read before painting a fallback", async () => {
    const pending = deferred<typeof MEMBER>();
    getMemberDetailAction.mockReturnValue(pending.promise);
    const page = MemberDetailPage({
      params: Promise.resolve({ memberId: MEMBER_ID }),
      searchParams: Promise.resolve({}),
    });
    expect(await settledWithin(page)).toBe("pending");
    pending.resolve(MEMBER);
    await act(async () => {});
  });
});

describe("the member edit page's own boundary", () => {
  // CONTROL: a missing member is refused before the form fallback.
  it("refuses a missing member before painting the form fallback", async () => {
    getMemberDetailAction.mockResolvedValue(null);
    await expect(
      EditMemberPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({ facility: FACILITY }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // CONTROL: the resolved form still renders with its scoped Cancel, and the
  // edit fallback never shows the directory.
  it("renders the resolved form without directory rows", async () => {
    const view = render(
      await EditMemberPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({ facility: FACILITY }),
      }),
    );
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}?facility=${FACILITY}`,
    );
    expect(view.queryByTestId("members-list")).toBeNull();
  });
});
