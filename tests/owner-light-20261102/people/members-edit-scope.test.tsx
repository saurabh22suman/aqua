// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the edit round-trip keeps
// the directory's scope.
//
// The same hard-reload root cause as the row and the tabs: a URL without
// `?facility=` on a facility-scoped path is normalised by the facility
// switcher with `window.location.replace`, and that reload erases the
// in-memory return intent.
//
// So the scope travels the whole way: the profile's "Edit details" link,
// the edit page's Back link, the form's Cancel, the save and the discard
// confirmation. The scope is the same resolved, validated one — the
// canonical facility from the URL, or an explicit "all".
//
// Nothing else changes: no authorisation, no permission, no mutation
// semantics, and a refused save still keeps the draft.
//
// No database: every server action is stubbed.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateMemberAction = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const listMembersAction = vi.hoisted(() => vi.fn());
const getTerminologyAction = vi.hoisted(() => vi.fn());

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
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/actions/people", () => ({
  updateMemberAction: (...args: unknown[]) => updateMemberAction(...args),
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
  searchPersonsAction: vi.fn(async () => []),
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

// The profile's heavy panels are stubbed; its links and tabs are not.
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

import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
import EditMemberPage from "@/app/(owner)/owner/members/[memberId]/edit/page";
import { MemberEditForm } from "@/components/member-edit-form";

const FACILITY = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const RETURN_HREF = `/owner/members/${MEMBER_ID}?facility=${FACILITY}`;

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
} as never;

beforeEach(() => {
  updateMemberAction.mockReset();
  updateMemberAction.mockResolvedValue({ ok: true });
  push.mockReset();
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([]);
  getTerminologyAction.mockReset();
  getTerminologyAction.mockResolvedValue({ locale: "en", overrides: {} });
});

afterEach(() => {
  cleanup();
});

describe("the edit round-trip keeps the scope", () => {
  // RED: the profile's Edit link has no scope, so the edit page's URL is
  // missing the query and the switcher normalises it with a reload.
  it("keeps the scope on the profile's Edit link", async () => {
    render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({ facility: FACILITY }),
      }),
    );
    expect(screen.getByRole("link", { name: /edit details/i }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}/edit?facility=${FACILITY}`,
    );
  });

  // RED: an all-facilities scope stays explicit.
  it("keeps an explicit all-facilities scope on the Edit link", async () => {
    render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({ facility: "all" }),
      }),
    );
    expect(screen.getByRole("link", { name: /edit details/i }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}/edit?facility=all`,
    );
  });

  // RED: the edit page's Back link returns to the PROFILE in the same
  // scope.
  it("keeps the scope on the edit page's Back link", async () => {
    render(
      await EditMemberPage({
        params: Promise.resolve({ memberId: MEMBER_ID }),
        searchParams: Promise.resolve({ facility: FACILITY }),
      }),
    );
    expect(screen.getByRole("link", { name: /member details/i }).getAttribute("href")).toBe(
      RETURN_HREF,
    );
  });

  // RED: the form's Cancel returns to the same scoped profile.
  it("keeps the scope on the form's Cancel link", () => {
    render(
      <MemberEditForm
        member={MEMBER}
        locations={[]}
        returnHref={RETURN_HREF}
      />,
    );
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe(
      RETURN_HREF,
    );
  });

  // RED: a successful save returns to the same scoped profile.
  it("keeps the scope when the save succeeds", async () => {
    render(
      <MemberEditForm
        member={MEMBER}
        locations={[]}
        returnHref={RETURN_HREF}
      />,
    );
    screen.getByRole("button", { name: /save changes/i }).click();
    await waitFor(() => expect(push).toHaveBeenCalledWith(RETURN_HREF));
  });

  // RED: the discard confirmation is the other successful way out.
  it("keeps the scope when the changes are discarded", async () => {
    render(
      <MemberEditForm
        member={MEMBER}
        locations={[]}
        returnHref={RETURN_HREF}
      />,
    );
    const name = screen.getByLabelText("Full name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Aaradhya Iyer Junior" } });
    screen.getByRole("link", { name: "Cancel" }).click();
    const discard = await screen.findByRole("button", { name: "Discard changes" });
    discard.click();
    await waitFor(() => expect(push).toHaveBeenCalledWith(RETURN_HREF));
  });

  // CONTROL: a consumer without a scope keeps today's plain destination.
  it("leaves a consumer without a scope unchanged", async () => {
    render(<MemberEditForm member={MEMBER} locations={[]} />);
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe(
      `/owner/members/${MEMBER_ID}`,
    );
    screen.getByRole("button", { name: /save changes/i }).click();
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/owner/members/${MEMBER_ID}`));
  });
});

describe("the form's Cancel", () => {
  // A clean Cancel is an ordinary link: it is NOT prevented, so next/link
  // owns the navigation, and its destination is the scoped profile. (The
  // extra imperative navigation tried here was measured NOT to fix the
  // production stall and was reverted.)
  it("leaves a clean Cancel to the link, with the scoped destination", () => {
    render(
      <MemberEditForm member={MEMBER} locations={[]} returnHref={RETURN_HREF} />,
    );
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    cancel.dispatchEvent(click);
    expect(click.defaultPrevented, "a clean Cancel must not be prevented").toBe(false);
    expect(cancel.getAttribute("href")).toBe(RETURN_HREF);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // CONTROL: a changed form never leaves without the confirmation, so the
  // draft is never lost.
  it("never navigates away from unsaved changes", () => {
    render(
      <MemberEditForm member={MEMBER} locations={[]} returnHref={RETURN_HREF} />,
    );
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aaradhya Iyer Junior" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /discard changes/i })).toBeTruthy();
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
      "Aaradhya Iyer Junior",
    );
  });

  // CONTROL: while a save is in flight the form owns the navigation — no
  // push and no dialog.
  it("suppresses navigation while a save is in flight", async () => {
    let settle: (value: unknown) => void = () => undefined;
    updateMemberAction.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(
      <MemberEditForm member={MEMBER} locations={[]} returnHref={RETURN_HREF} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /saving/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      settle({ ok: false, error: "refused" });
    });
  });

  // CONTROL: a modified click belongs to the browser (a new tab), so it is
  // never taken over.
  it("leaves a modified click to the browser", () => {
    render(
      <MemberEditForm member={MEMBER} locations={[]} returnHref={RETURN_HREF} />,
    );
    const cancel = screen.getByRole("link", { name: "Cancel" });
    fireEvent.click(cancel, { ctrlKey: true });
    expect(push).not.toHaveBeenCalled();
    expect(cancel.getAttribute("href")).toBe(RETURN_HREF);
  });
});
