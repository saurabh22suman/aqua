// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — origin-aware Cancel.
//
// The genuine r7 normal-Chrome failure: profile → Edit → clean Cancel sometimes
// stalls 10 s on the edit URL (the first fast cycle succeeds, the next does
// not). The bounded alternative is to return with the browser's own Back when
// this edit was demonstrably opened from the profile's own Edit details link
// for the same tenant/actor, member and facility — and to keep the existing
// profile href navigation in every other case.
//
// These rendered tests pin the semantics only (no helper or class names):
//   - a genuine Edit → Cancel uses the public router Back, once;
//   - a deep link, a stale/consumed intent, another member, tenant, facility or
//     a changed destination keeps the real href navigation;
//   - a modified click is never taken over;
//   - StrictMode's second effect setup does not lose the captured origin;
//   - busy and dirty guards, the Discard path and the save-success push are
//     unchanged.
//
// No database: every server action is stubbed.

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateMemberAction = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const back = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const listMembersAction = vi.hoisted(() => vi.fn());
const getTerminologyAction = vi.hoisted(() => vi.fn());
const owner = vi.hoisted(() => ({ tenantId: "tenant-1", userId: "user-1" }));

// The installed 15.5.28 Link calls `onNavigate` only for a plain, unmodified,
// local click (link.js `linkClicked` returns before it for modified events).
// This shim keeps that order so the test exercises the real contract.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      onNavigate?: (opts: { preventDefault: () => void }) => void;
      onClick?: (event: React.MouseEvent) => void;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, onNavigate, onClick, children, ...rest } = props;
      return React.createElement(
        "a",
        {
          href: typeof href === "string" ? href : "#",
          "data-next-link": "",
          ...rest,
          onClick: (event: React.MouseEvent) => {
            onClick?.(event);
            if (event.defaultPrevented) return;
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              event.button !== 0
            ) {
              return;
            }
            onNavigate?.({ preventDefault: () => event.preventDefault() });
          },
        },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push, back, replace, refresh: vi.fn() }),
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: owner.tenantId,
    userId: owner.userId,
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write"]),
    features: new Set(["members"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: () => true,
  hasFeature: () => false,
}));

vi.mock("@/lib/actions/people", () => ({
  updateMemberAction: (...args: unknown[]) => updateMemberAction(...args),
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
  searchPersonsAction: vi.fn(async () => []),
  getMemberDetailAction: async (memberId: string) => ({
    memberId,
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

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// The profile's heavy panels are stubbed; its links and header are not.
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
vi.mock("@/components/member-detail/owner-member-initial-panels", () => ({
  readOwnerMemberInitialPanels: async () => null,
}));

import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
import EditMemberPage from "@/app/(owner)/owner/members/[memberId]/edit/page";
import {
  EDIT_ENTRY_STATE_KEY,
  clearMemberEditEntry,
  memberEditDocumentNavigation,
  peekMemberEditEntry,
  recordMemberEditEntry,
  MemberEditEntryLink,
} from "@/components/member-detail/member-edit-entry";
import { MemberEditForm } from "@/components/member-edit-form";
import {
  clearMembersReturnIntent,
  recordMembersReturnIntent,
} from "@/components/members-list-navigation";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_MEMBER = "33333333-3333-4333-8333-333333333333";
const FACILITY = "22222222-2222-4222-8222-222222222222";
const OTHER_FACILITY = "44444444-4444-4444-8444-444444444444";
const RETURN_HREF = `/owner/members/${MEMBER_ID}?facility=${FACILITY}`;
const OTHER_RETURN_HREF = `/owner/members/${MEMBER_ID}?facility=${OTHER_FACILITY}`;
const PROFILE_URL = `/owner/members/${MEMBER_ID}?facility=${FACILITY}`;

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

/** The browser is really on this URL (jsdom does not navigate by itself). */
function setUrl(path: string) {
  window.history.replaceState(null, "", path);
}
const EDIT_HREF = `/owner/members/${MEMBER_ID}/edit?facility=${FACILITY}`;

async function renderProfile({
  memberId = MEMBER_ID,
  facility = FACILITY,
  extra = {},
}: { memberId?: string; facility?: string; extra?: Record<string, string> } = {}) {
  setUrl(
    `/owner/members/${memberId}?facility=${facility}${
      Object.keys(extra).length
        ? `&${new URLSearchParams(extra).toString()}`
        : ""
    }`,
  );
  const page = await MemberDetailPage({
    params: Promise.resolve({ memberId }),
    searchParams: Promise.resolve({ facility, ...extra }),
  });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(page);
  });
  return view;
}

async function renderEdit({
  memberId = MEMBER_ID,
  facility = FACILITY,
  extra = {},
  strict = false,
  historyState,
}: {
  memberId?: string;
  facility?: string;
  extra?: Record<string, string>;
  strict?: boolean;
  historyState?: unknown;
} = {}) {
  setUrl(
    `/owner/members/${memberId}/edit?facility=${facility}${
      Object.keys(extra).length
        ? `&${new URLSearchParams(extra).toString()}`
        : ""
    }`,
  );
  if (historyState !== undefined) {
    window.history.replaceState(historyState, "", window.location.href);
  }
  const page = await EditMemberPage({
    params: Promise.resolve({ memberId }),
    searchParams: Promise.resolve({ facility, ...extra }),
  });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(strict ? <StrictMode>{page}</StrictMode> : page);
  });
  return view;
}

/** The genuine journey: open the profile, click its own Edit details link. */
async function openEditFromProfile(options: Parameters<typeof renderProfile>[0] = {}) {
  await renderProfile(options);
  const edit = screen.getByRole("link", { name: /edit details/i });
  expect(edit.getAttribute("href")).toBe(
    options.memberId && options.memberId !== MEMBER_ID
      ? `/owner/members/${options.memberId}/edit?facility=${options.facility ?? FACILITY}`
      : EDIT_HREF,
  );
  fireEvent.click(edit);
  cleanup();
}

beforeEach(() => {
  clearMemberEditEntry();
  clearMembersReturnIntent();
  owner.tenantId = "tenant-1";
  owner.userId = "user-1";
  updateMemberAction.mockReset();
  updateMemberAction.mockResolvedValue({ ok: true });
  push.mockReset();
  back.mockReset();
  replace.mockReset();
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([]);
  getTerminologyAction.mockReset();
  getTerminologyAction.mockResolvedValue({ locale: "en", overrides: {} });
});

afterEach(cleanup);

describe("the origin-aware Cancel", () => {
  // RED: a genuine Edit → Cancel still asks the router for a fresh profile
  // navigation (the r7 stall path) instead of returning with Back.
  it("returns with the browser's own Back for a genuine Edit → Cancel", async () => {
    await openEditFromProfile();
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(click.defaultPrevented, "the link must not also navigate").toBe(true);
  });

  // CONTROL: a deep link has no intent, so the real href navigation stays.
  it("keeps the profile href for a deep-linked edit", async () => {
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
    expect(cancel.getAttribute("href")).toBe(RETURN_HREF);
  });

  // CONTROL: another member never inherits the intent.
  it("ignores an intent recorded for another member", async () => {
    await openEditFromProfile();
    await renderEdit({ memberId: OTHER_MEMBER });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // CONTROL: another tenant or actor never inherits the intent.
  it("ignores an intent recorded for another tenant or actor", async () => {
    await openEditFromProfile();
    owner.userId = "user-2";
    await renderEdit();
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // CONTROL: another facility never inherits the intent.
  it("ignores an intent recorded under another facility", async () => {
    await openEditFromProfile();
    await renderEdit({ facility: OTHER_FACILITY });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // CONTROL: a changed edit destination never inherits the intent.
  it("ignores an intent whose edit destination changed", async () => {
    await openEditFromProfile();
    await renderEdit({ extra: { from: "roster" } });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // CONTROL: a consumed intent cannot be reused by a later mount.
  it("does not reuse a consumed intent on a later edit mount", async () => {
    await openEditFromProfile();
    await renderEdit();
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).toHaveBeenCalledTimes(1);
    cleanup();
    back.mockReset();
    await renderEdit();
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // RED: StrictMode's second effect setup must not erase the captured origin.
  it("keeps the origin across a StrictMode double effect", async () => {
    await openEditFromProfile();
    await renderEdit({ strict: true });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  // CONTROL: a modified click belongs to the browser.
  it("never takes over a modified Cancel click", async () => {
    await openEditFromProfile();
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });
});

describe("the edit form's existing guards", () => {
  // CONTROL: a dirty Cancel still asks, and the confirmed Discard returns by
  // the same origin-aware Back without saving.
  it("keeps Keep editing and uses Back for a confirmed Discard", async () => {
    await openEditFromProfile();
    await renderEdit();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aaradhya Iyer Junior" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(updateMemberAction).not.toHaveBeenCalled();
  });

  // CONTROL: a save in flight still owns the navigation.
  it("suppresses Cancel while a save is in flight", async () => {
    let settle: (value: unknown) => void = () => undefined;
    updateMemberAction.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    await openEditFromProfile();
    await renderEdit();
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /saving/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      settle({ ok: false, error: "refused" });
    });
  });

  // CONTROL: a successful save is unchanged — it pushes the scoped profile.
  it("keeps the save-success navigation unchanged", async () => {
    await openEditFromProfile();
    await renderEdit();
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(RETURN_HREF));
    expect(back).not.toHaveBeenCalled();
  });
});

// The first candidate captured an origin string once and returned it forever.
// These are the review's F1/F2/F3 regressions: a changed facility, destination
// or actor must never use the stale Back; an abandoned entry must not look
// profile-originated later; and a mount must consume only the token it captured.
const INTENT_A = {
  namespace: "tenant-1:user-1",
  memberId: MEMBER_ID,
  facility: FACILITY,
  editHref: EDIT_HREF,
};

function formWith(intent: typeof INTENT_A, returnHref = RETURN_HREF) {
  return (
    <MemberEditForm
      member={MEMBER}
      locations={[]}
      returnHref={returnHref}
      originIntent={intent}
    />
  );
}

describe("a rerendered edit form never uses a stale origin", () => {
  // F1 RED: the captured origin survived a facility change.
  it("ignores a captured intent when the facility changes (Cancel)", () => {
    recordMemberEditEntry({ ...INTENT_A, originHref: PROFILE_URL });
    setUrl(EDIT_HREF);
    const changed = {
      ...INTENT_A,
      facility: OTHER_FACILITY,
      editHref: `/owner/members/${MEMBER_ID}/edit?facility=${OTHER_FACILITY}`,
    };
    const view = render(formWith(INTENT_A));
    view.rerender(formWith(changed, OTHER_RETURN_HREF));
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(back).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
    expect(cancel.getAttribute("href")).toBe(OTHER_RETURN_HREF);
  });

  // F1 RED: the captured origin survived a changed edit destination.
  it("ignores a captured intent when the edit destination changes (Cancel)", () => {
    recordMemberEditEntry({ ...INTENT_A, originHref: PROFILE_URL });
    setUrl(EDIT_HREF);
    const changed = { ...INTENT_A, editHref: `${EDIT_HREF}&from=roster` };
    const view = render(formWith(INTENT_A));
    view.rerender(formWith(changed));
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // F1 RED: the captured origin survived an actor change.
  it("ignores a captured intent when the actor namespace changes (Cancel)", () => {
    recordMemberEditEntry({ ...INTENT_A, originHref: PROFILE_URL });
    setUrl(EDIT_HREF);
    const changed = { ...INTENT_A, namespace: "tenant-1:user-2" };
    const view = render(formWith(INTENT_A));
    view.rerender(formWith(changed));
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // F1 RED: the same staleness must not leak through the Discard path.
  it("ignores a captured intent when the facility changes (confirmed Discard)", async () => {
    recordMemberEditEntry({ ...INTENT_A, originHref: PROFILE_URL });
    setUrl(EDIT_HREF);
    const changed = {
      ...INTENT_A,
      facility: OTHER_FACILITY,
      editHref: `/owner/members/${MEMBER_ID}/edit?facility=${OTHER_FACILITY}`,
    };
    const view = render(formWith(INTENT_A));
    view.rerender(formWith(changed, OTHER_RETURN_HREF));
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aaradhya Iyer Junior" },
    });
    const assign = vi.spyOn(memberEditDocumentNavigation, "assign").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    // The changed scope keeps the CURRENT real href and, with no proven origin
    // and no scoped directory state, leaves through a document navigation.
    await waitFor(() => expect(assign).toHaveBeenCalledWith(OTHER_RETURN_HREF));
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    assign.mockRestore();
  });
});

describe("an abandoned entry is not profile-originated later", () => {
  // F2 RED: the intent stayed valid after the source link unmounted for a
  // different committed destination, so a later direct edit looked genuine.
  it("does not return by Back after an abandoned Edit click", async () => {
    await renderProfile();
    fireEvent.click(screen.getByRole("link", { name: /edit details/i }));
    setUrl("/owner/fees");
    cleanup();
    await renderEdit();
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // F2 RED: recording must be refused when the click is not on this profile.
  it("records nothing when the click did not happen on this profile", () => {
    setUrl("/owner/fees");
    render(
      <MemberEditEntryLink
        href={EDIT_HREF}
        namespace="tenant-1:user-1"
        memberId={MEMBER_ID}
        facility={FACILITY}
      >
        Edit details
      </MemberEditEntryLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Edit details" }));
    expect(peekMemberEditEntry()).toBeNull();
  });
});

describe("a mount consumes only its own token", () => {
  // F3 RED: the effect re-read a NEW matching intent and consumed it.
  it("preserves an intent recorded after this mount captured an older one", () => {
    recordMemberEditEntry({ ...INTENT_A, originHref: PROFILE_URL, token: "token-a" });
    setUrl(EDIT_HREF);
    const view = render(formWith(INTENT_A));
    recordMemberEditEntry({ ...INTENT_A, originHref: PROFILE_URL, token: "token-b" });
    view.rerender(formWith({ ...INTENT_A }));
    expect(peekMemberEditEntry()?.token).toBe("token-b");
  });
});

// r8: the normal 30 fast cycles and Keep editing/Discard passed in both themes,
// then Browser Forward reopened Edit and Cancel stalled — the one-time module
// capture is gone on that re-entry. This is the scoped history-entry metadata
// (the same ordinary navigation-state pattern as the member-list filters), never
// a storage backend and never server authorization.
const HISTORY_KEY = EDIT_ENTRY_STATE_KEY;

function historyRecord(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    token: "history-token",
    namespace: "tenant-1:user-1",
    memberId: MEMBER_ID,
    facility: FACILITY,
    editHref: EDIT_HREF,
    sourceHref: PROFILE_URL,
    ...overrides,
  };
}

describe("the edit history-entry record (Forward recovery)", () => {
  // RED: nothing was stamped on the edit history entry.
  it("stamps a bounded record on the edit entry after a genuine entry", async () => {
    await openEditFromProfile();
    await renderEdit();
    const record = (window.history.state ?? {})[HISTORY_KEY];
    expect(record).toMatchObject({
      namespace: "tenant-1:user-1",
      memberId: MEMBER_ID,
      facility: FACILITY,
      editHref: EDIT_HREF,
      sourceHref: PROFILE_URL,
    });
    // UX metadata only: no person payload, no phone, no financial data.
    expect(JSON.stringify(record)).not.toMatch(/Aaradhya|919812|medical/i);
  });

  // RED: a Forward remount has no module capture and must recover its own
  // history record instead of falling back to the stalled forward navigation.
  it("recovers the origin from its own history entry on a Forward remount", async () => {
    await openEditFromProfile();
    await renderEdit();
    const stamped = window.history.state;
    cleanup();
    clearMemberEditEntry();
    await renderEdit({ historyState: stamped });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  // CONTROL: a direct edit with no record keeps the href navigation.
  it("keeps the href for a direct edit with no record", async () => {
    await renderEdit();
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // CONTROL: a direct edit must not be stamped without a demonstrated origin.
  it("does not stamp a direct edit", async () => {
    await renderEdit();
    expect((window.history.state ?? {})[HISTORY_KEY]).toBeUndefined();
  });

  // CONTROL: unknown/corrupt/wrong records never grant Back.
  it.each([
    ["wrong version", { v: 2 }],
    ["wrong actor", { namespace: "tenant-1:user-2" }],
    ["wrong member", { memberId: OTHER_MEMBER }],
    ["wrong facility", { facility: OTHER_FACILITY }],
    ["wrong destination", { editHref: `${EDIT_HREF}&from=x` }],
    ["external source", { sourceHref: "https://evil.example/owner/members/" + MEMBER_ID }],
    ["foreign profile source", { sourceHref: `/owner/members/${OTHER_MEMBER}` }],
    ["unbounded token", { token: "x".repeat(4096) }],
  ])("ignores a %s record", async (_label, overrides) => {
    await renderEdit({ historyState: { [HISTORY_KEY]: historyRecord(overrides) } });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // RED: stamping must merge, never drop, the entry's other state.
  it("preserves unrelated history state fields", async () => {
    await openEditFromProfile();
    await renderEdit({ historyState: { keepMe: "yes", nested: { a: 1 } } });
    const state = window.history.state ?? {};
    expect(state.keepMe).toBe("yes");
    expect(state.nested).toEqual({ a: 1 });
    expect(state[HISTORY_KEY]).toBeTruthy();
  });

  // RED: StrictMode's second effect must not rewrite the same record.
  it("does not rewrite the same record twice under StrictMode", async () => {
    const spy = vi.spyOn(window.history, "replaceState");
    await openEditFromProfile();
    await renderEdit({ strict: true });
    const writes = spy.mock.calls.filter(
      (call) => (call[0] as Record<string, unknown> | null)?.[HISTORY_KEY],
    );
    expect(writes).toHaveLength(1);
    spy.mockRestore();
  });
});

// F4: the record's facility was only checked against the edit destination, so a
// source profile URL for ANOTHER facility was accepted. A source without a
// facility is canonically "all"; duplicate facility parameters are ambiguous.
describe("the record's facility consistency", () => {
  // RED: facility A / edit A with a source for facility B offered Back.
  it("ignores a record whose source facility differs", async () => {
    await renderEdit({
      historyState: {
        [HISTORY_KEY]: historyRecord({
          sourceHref: `/owner/members/${MEMBER_ID}?facility=${OTHER_FACILITY}`,
        }),
      },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // CONTROL: a source with no facility is canonically "all".
  it("accepts a source with no facility when the scope is all", async () => {
    await renderEdit({
      facility: "all",
      historyState: {
        [HISTORY_KEY]: historyRecord({
          facility: "all",
          editHref: `/owner/members/${MEMBER_ID}/edit?facility=all`,
          sourceHref: `/owner/members/${MEMBER_ID}`,
        }),
      },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  // CONTROL: an "all" record never matches a concrete facility source.
  it("ignores an all-scope record whose source names another facility", async () => {
    await renderEdit({
      facility: "all",
      historyState: {
        [HISTORY_KEY]: historyRecord({
          facility: "all",
          editHref: `/owner/members/${MEMBER_ID}/edit?facility=all`,
          sourceHref: `/owner/members/${MEMBER_ID}?facility=${FACILITY}`,
        }),
      },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  // CONTROL: duplicate facility parameters are ambiguous.
  it("rejects duplicate facility parameters in the source", async () => {
    await renderEdit({
      historyState: {
        [HISTORY_KEY]: historyRecord({
          sourceHref: `/owner/members/${MEMBER_ID}?facility=${FACILITY}&facility=${OTHER_FACILITY}`,
        }),
      },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });

  it("rejects duplicate facility parameters in the edit destination", async () => {
    await renderEdit({
      historyState: {
        [HISTORY_KEY]: historyRecord({
          editHref: `${EDIT_HREF}&facility=${OTHER_FACILITY}`,
        }),
      },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(back).not.toHaveBeenCalled();
  });
});

// r9: a DIRECT document edit (no demonstrated origin) still used the client
// Link and could stall on the forward-RSC path. The bounded policy: proven
// origin → public Back; no origin but a matching in-memory directory return →
// keep the client route (its filters/scroll); neither → a normal document
// navigation to the canonical profile href.
function directoryIntent(locationId = FACILITY) {
  recordMembersReturnIntent({
    namespace: "tenant-1:user-1",
    locationId,
    search: "rao",
    status: "active",
    scrollY: 640,
  });
}

describe("a direct edit with no demonstrated origin", () => {
  // RED: it rendered Next's client Link (the stalled forward path).
  it("uses a normal document anchor when there is no scoped directory state", async () => {
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    expect(cancel.hasAttribute("data-next-link")).toBe(false);
    expect(cancel.getAttribute("href")).toBe(RETURN_HREF);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // RED: with a matching directory return the client route must be kept.
  it("keeps the client route when a matching directory return exists", async () => {
    directoryIntent();
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith(RETURN_HREF);
    expect(back).not.toHaveBeenCalled();
  });

  // CONTROL: another namespace never inherits the directory return.
  it("ignores a directory return for another namespace", async () => {
    recordMembersReturnIntent({
      namespace: "tenant-1:user-2",
      locationId: FACILITY,
      search: "rao",
      status: "active",
      scrollY: 10,
    });
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  // CONTROL: another facility never inherits the directory return.
  it("ignores a directory return for another facility", async () => {
    directoryIntent(OTHER_FACILITY);
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  // RED: Discard used the stalled client push instead of a document navigation.
  it("uses a document navigation for a confirmed Discard with no scoped state", async () => {
    const assign = vi.spyOn(memberEditDocumentNavigation, "assign").mockImplementation(() => {});
    await renderEdit();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aaradhya Iyer Junior" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(assign).toHaveBeenCalledWith(RETURN_HREF);
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  // CONTROL: a matching directory return keeps the client route on Discard.
  it("keeps the client route on Discard when a directory return exists", async () => {
    const assign = vi.spyOn(memberEditDocumentNavigation, "assign").mockImplementation(() => {});
    directoryIntent();
    await renderEdit();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aaradhya Iyer Junior" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(RETURN_HREF));
    expect(assign).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  // CONTROL: a proven origin still uses public Back, not a document load.
  it("keeps public Back when the origin is proven", async () => {
    await openEditFromProfile();
    await renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  // CONTROL: a legacy consumer without the optional props keeps Next's Link.
  it("keeps Next's Link for a consumer without the optional props", () => {
    setUrl("/owner/fees");
    render(<MemberEditForm member={MEMBER} locations={[]} returnHref={RETURN_HREF} />);
    const cancel = screen.getByRole("link", { name: "Cancel" });
    expect(cancel.hasAttribute("data-next-link")).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      cancel.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
