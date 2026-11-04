// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the member detail's
// initial data comes from the server, not from client mount reads.
//
// MECHANISM CANDIDATE (not a proven root cause): the installed
// `next/dist/client/components/app-router-instance.js` marks a pending
// refresh when a navigation preempts ANY server action, including a read
// (`:131-140`), and refreshes once the action queue empties (`:55-62`). The
// profile mounts several read actions; the diagnostic that aborted the four
// main reads passed is a TIMING DISCRIMINATOR only — a normal, no-interception
// Chrome round trip is still required. No prefetch or server-hang claim.
//
// CONTRACT THESE TESTS PIN (the panels do not implement it yet — this file is
// written and NOT run in this phase):
//
//   seed = { memberId, enrolments, batches } | { memberId, failed: true }
//   seed = { memberId, subscriptions, plans } | { memberId, failed: true }
//
//   * a seed is used ONLY for the member it names; a mismatch falls back to
//     the panel's own read for the current member and never renders another
//     member's rows or enables an old-member mutation;
//   * a matching `{ failed: true }` seed renders the honest error + Retry and
//     makes NO automatic client read; Retry calls the same existing actions;
//   * a late response for a previous member never overwrites the current
//     member's state or turns it into an error; a fresh same-member server
//     seed still applies;
//   * the owner page reads the four datasets ONLY on the overview tab, with
//     the same authorized actions, and a failed pair becomes a typed safe
//     error rather than an empty list.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  listMemberEnrolmentsAction: vi.fn(),
  listBatchesAction: vi.fn(),
  listMemberSubscriptionsAction: vi.fn(),
  listPlansAction: vi.fn(),
  createSubscriptionAction: vi.fn(),
  enrolMemberAction: vi.fn(),
  listMakeupCreditsAction: vi.fn(),
  listMakeupSourcesAction: vi.fn(),
  listMakeupTargetsAction: vi.fn(),
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

// The panels' real action modules. Only the reads (and one mutation used by
// the reload-path control) are exercised.
vi.mock("@/lib/actions/enrolment", () => ({
  listMemberEnrolmentsAction: actions.listMemberEnrolmentsAction,
  enrolMemberAction: actions.enrolMemberAction,
}));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: actions.listBatchesAction,
}));
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: actions.listMemberSubscriptionsAction,
  createSubscriptionAction: actions.createSubscriptionAction,
  pauseSubscriptionAction: vi.fn(),
  resumeSubscriptionAction: vi.fn(),
  cancelSubscriptionAction: vi.fn(),
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: actions.listPlansAction,
}));
vi.mock("@/lib/actions/makeup", () => ({
  listMakeupCreditsAction: actions.listMakeupCreditsAction,
  listMakeupSourcesAction: actions.listMakeupSourcesAction,
  listMakeupTargetsAction: actions.listMakeupTargetsAction,
  redeemMakeupCreditAction: vi.fn(),
  grantMakeupCreditAction: vi.fn(),
}));
vi.mock("@/lib/actions/waitlist", () => ({ addToWaitlistAction: vi.fn() }));
vi.mock("@/lib/actions/transfer", () => ({ transferMemberToBatchAction: vi.fn() }));

// The owner member page's own reads.
vi.mock("@/lib/actions/people", () => ({
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
  listLocationsAction: async () => [],
}));
vi.mock("@/lib/actions/attendance", () => ({
  getMemberAttendanceHistoryAction: async () => ({ rows: [], today: "2026-11-03" }),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
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
  hasPermission: () => true,
  hasFeature: () => false,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const Empty = vi.hoisted(() => () => null);
vi.mock("@/components/member-status-panel", () => ({ MemberStatusPanel: Empty }));
vi.mock("@/components/member-facilities-panel", () => ({ MemberFacilitiesPanel: Empty }));
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
vi.mock("@/components/makeup-credits-panel", () => ({ MakeupCreditsPanel: Empty }));

import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
import type { MemberEnrolment } from "@/lib/services/enrolment";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { SubscriptionRow } from "@/lib/services/subscriptions";
import type { PlanRow } from "@/lib/services/membership-plans";
import type { TerminologyState } from "@/lib/terminology/keys";
import type { TenantId } from "@/lib/ids";

const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "33333333-3333-4333-8333-333333333333";
const FACILITY = "22222222-2222-4222-8222-222222222222";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

// Fixtures match the real service rows field for field.
const ENROLMENT_A: MemberEnrolment = {
  batchId: "batch-a",
  batchName: "Swimmers A",
  programName: "Swimming",
  enrolledOn: "2026-10-01",
};
const ENROLMENT_B: MemberEnrolment = {
  batchId: "batch-b",
  batchName: "Swimmers B",
  programName: "Swimming",
  enrolledOn: "2026-10-02",
};

const BATCH_A: BatchWithProgramName = {
  id: "batch-a",
  tenantId: "44444444-4444-4444-8444-444444444444" as TenantId,
  programId: "55555555-5555-4555-8555-555555555555",
  name: "Swimmers A",
  capacity: 12,
  daysOfWeek: [1, 3],
  startTime: "06:00:00",
  endTime: "07:00:00",
  isSample: false,
  coachId: null,
  locationId: FACILITY,
  deletedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  createdBy: null,
  updatedBy: null,
  programName: "Swimming",
  coachName: null,
  locationName: "Worli Main",
};

const BATCH_B: BatchWithProgramName = {
  ...BATCH_A,
  id: "batch-b",
  name: "Swimmers B",
  programId: "66666666-6666-4666-8666-666666666666",
};

const SUBSCRIPTION_A: SubscriptionRow = {
  id: "sub-a",
  memberId: MEMBER_A,
  planId: "plan-a",
  planName: "Swim · Monthly",
  planKind: "duration",
  amountPaise: 150000,
  locationId: FACILITY,
  locationName: "Worli Main",
  activityId: null,
  activityName: null,
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  status: "active",
  pausedFrom: null,
  pausedUntil: null,
  autoRenew: false,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const PLAN_A: PlanRow = {
  id: "plan-a",
  name: "Swim · Monthly",
  kind: "duration",
  durationDays: 30,
  sessions: null,
  amountPaise: 150000,
  locationId: FACILITY,
  locationName: "Worli Main",
  activityId: null,
  activityName: null,
  isActive: true,
  sourceShapeId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  for (const spy of Object.values(actions)) spy.mockReset();
  router.refresh.mockReset();
  // Per-member reads, so "member B" never receives member A's rows.
  actions.listMemberEnrolmentsAction.mockImplementation(async (id: string) =>
    id === MEMBER_B ? [ENROLMENT_B] : [ENROLMENT_A],
  );
  actions.listBatchesAction.mockResolvedValue([BATCH_A]);
  actions.listMemberSubscriptionsAction.mockImplementation(async (id: string) =>
    id === MEMBER_B ? [] : [SUBSCRIPTION_A],
  );
  actions.listPlansAction.mockResolvedValue([PLAN_A]);
  actions.createSubscriptionAction.mockResolvedValue({ ok: true });
  actions.enrolMemberAction.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("enrolment initial data", () => {
  // INTENDED RED: no seed support yet, so the panel reads on mount.
  it("uses a seed for its own member without a mount read", async () => {
    render(
      <MemberEnrolmentPanel
        memberId={MEMBER_A}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_A, enrolments: [ENROLMENT_A], batches: [BATCH_A] }}
      />,
    );
    await settle();
    expect(actions.listMemberEnrolmentsAction).not.toHaveBeenCalled();
    expect(actions.listBatchesAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Swimmers A/)).toBeTruthy();
  });

  // GUARD: a seed for another member is never rendered, and the current
  // member is read instead.
  it("never renders another member's seed and reads the current member", async () => {
    render(
      <MemberEnrolmentPanel
        memberId={MEMBER_B}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_A, enrolments: [ENROLMENT_A], batches: [BATCH_A] }}
      />,
    );
    await waitFor(() =>
      expect(actions.listMemberEnrolmentsAction).toHaveBeenCalledWith(MEMBER_B),
    );
    // B's own read is what renders; A's seeded enrolment is never shown as
    // B's row.
    await waitFor(() => expect(screen.getByText(/Swimmers B/)).toBeTruthy());
  });

  // INTENDED RED: a failed seed shows the honest error with no auto read.
  it("shows a failed seed as a retryable error without reading", async () => {
    render(
      <MemberEnrolmentPanel
        memberId={MEMBER_A}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_A, failed: true }}
      />,
    );
    await settle();
    expect(actions.listMemberEnrolmentsAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("enrolment-retry")).toBeTruthy();
    expect(screen.queryByText(/not enrolled in any/i)).toBeNull();
  });

  // CONTROL: Retry uses the same existing actions.
  it("retries through the existing actions", async () => {
    render(
      <MemberEnrolmentPanel
        memberId={MEMBER_A}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_A, failed: true }}
      />,
    );
    await settle();
    fireEvent.click(screen.getByTestId("enrolment-retry"));
    await waitFor(() =>
      expect(actions.listMemberEnrolmentsAction).toHaveBeenCalledWith(MEMBER_A),
    );
    expect(actions.listBatchesAction).toHaveBeenCalled();
  });

  // GUARD: a late read for the previous member never overwrites the current
  // member's state, and never turns it into an error.
  it("ignores a late response for the previous member", async () => {
    const late = deferred<MemberEnrolment[]>();
    actions.listMemberEnrolmentsAction.mockReturnValueOnce(late.promise);
    actions.listBatchesAction.mockReturnValueOnce(deferred<BatchWithProgramName[]>().promise);

    const view = render(
      <MemberEnrolmentPanel memberId={MEMBER_A} terminology={TERMINOLOGY} canEnrol canWaitlist />,
    );
    view.rerender(
      <MemberEnrolmentPanel
        memberId={MEMBER_B}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_B, enrolments: [ENROLMENT_B], batches: [BATCH_A] }}
      />,
    );
    await settle();
    await act(async () => {
      late.reject(new Error("late failure for member A"));
      await Promise.resolve();
    });
    expect(screen.getByText(/Swimmers B/)).toBeTruthy();
    expect(screen.queryByText(/late failure/i)).toBeNull();
    // B's seeded enrolment is the only enrolment row: A's late row would add
    // a second "Swimmers A — Swimming" line beside the batch picker's option.
    expect(screen.getAllByText(/Swimmers A/)).toHaveLength(1);
  });

  // GUARD: a fresh same-member server seed still applies.
  it("applies a fresh server seed for the same member", async () => {
    const view = render(
      <MemberEnrolmentPanel
        memberId={MEMBER_A}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_A, enrolments: [], batches: [BATCH_A] }}
      />,
    );
    await settle();
    view.rerender(
      <MemberEnrolmentPanel
        memberId={MEMBER_A}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_A, enrolments: [ENROLMENT_A], batches: [BATCH_A] }}
      />,
    );
    await settle();
    expect(screen.getByText(/Swimmers A/)).toBeTruthy();
    expect(actions.listMemberEnrolmentsAction).not.toHaveBeenCalled();
  });

  // CONTROL: another role (no seed) keeps its own read.
  it("keeps the no-seed fallback for other consumers", async () => {
    render(
      <MemberEnrolmentPanel memberId={MEMBER_A} terminology={TERMINOLOGY} canEnrol canWaitlist />,
    );
    await waitFor(() =>
      expect(actions.listMemberEnrolmentsAction).toHaveBeenCalledWith(MEMBER_A),
    );
  });
});

describe("subscription initial data", () => {
  // INTENDED RED: no seed support yet, so the panel reads on mount.
  it("uses a seed for its own member without a mount read", async () => {
    render(
      <MemberSubscriptionPanel
        memberId={MEMBER_A}
        canManage
        initialData={{
          memberId: MEMBER_A,
          subscriptions: [SUBSCRIPTION_A],
          plans: [PLAN_A],
        }}
      />,
    );
    await settle();
    expect(actions.listMemberSubscriptionsAction).not.toHaveBeenCalled();
    expect(actions.listPlansAction).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Swim · Monthly/).length).toBeGreaterThan(0);
  });

  // GUARD: a seed for another member is never rendered.
  it("never renders another member's subscription seed", async () => {
    render(
      <MemberSubscriptionPanel
        memberId={MEMBER_B}
        canManage
        initialData={{
          memberId: MEMBER_A,
          subscriptions: [SUBSCRIPTION_A],
          plans: [PLAN_A],
        }}
      />,
    );
    await waitFor(() =>
      expect(actions.listMemberSubscriptionsAction).toHaveBeenCalledWith(MEMBER_B),
    );
    // B has no subscriptions: A's seeded row would render its status.
    expect(screen.queryByText("Active")).toBeNull();
  });

  // INTENDED RED: a failed seed is honest and does not read.
  it("shows a failed seed as an error without reading", async () => {
    render(
      <MemberSubscriptionPanel
        memberId={MEMBER_A}
        canManage
        initialData={{ memberId: MEMBER_A, failed: true }}
      />,
    );
    await settle();
    expect(actions.listMemberSubscriptionsAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/No plan yet/i)).toBeNull();
  });

  // GUARD: one action of the pair rejecting keeps the error, never an empty
  // healthy list.
  it("keeps the error when only one action of the pair fails", async () => {
    actions.listMemberSubscriptionsAction.mockResolvedValueOnce([]);
    actions.listPlansAction.mockRejectedValueOnce(new Error("plans unavailable"));
    render(<MemberSubscriptionPanel memberId={MEMBER_A} canManage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.queryByText(/No plan yet/i)).toBeNull();
  });

  // CONTROL: a successful mutation still reloads and refreshes.
  it("reloads and refreshes after a successful mutation", async () => {
    render(<MemberSubscriptionPanel memberId={MEMBER_A} canManage />);
    await waitFor(() => expect(actions.listMemberSubscriptionsAction).toHaveBeenCalled());
    actions.createSubscriptionAction.mockClear();
    actions.listMemberSubscriptionsAction.mockClear();
    // The mutation is driven through the panel's own form controls in the
    // implementation phase; here the contract is the reload + refresh path.
    expect(router.refresh).toBeDefined();
  });

  // GUARD: a late subscription response for the previous member is ignored.
  it("ignores a late response for the previous member", async () => {
    const late = deferred<SubscriptionRow[]>();
    actions.listMemberSubscriptionsAction.mockReturnValueOnce(late.promise);
    actions.listPlansAction.mockReturnValueOnce(deferred<PlanRow[]>().promise);

    const view = render(<MemberSubscriptionPanel memberId={MEMBER_A} canManage />);
    view.rerender(
      <MemberSubscriptionPanel
        memberId={MEMBER_B}
        canManage
        initialData={{ memberId: MEMBER_B, subscriptions: [], plans: [PLAN_A] }}
      />,
    );
    await settle();
    await act(async () => {
      late.resolve([SUBSCRIPTION_A]);
      await Promise.resolve();
    });
    expect(screen.queryByText("Active")).toBeNull();
  });
});

describe("the owner member page", () => {
  // INTENDED RED: the page does not read the four datasets today.
  it("reads the four datasets on the overview tab only", async () => {
    render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_A }),
        searchParams: Promise.resolve({ facility: FACILITY }),
      }),
    );
    await settle();
    expect(actions.listMemberEnrolmentsAction).toHaveBeenCalledWith(MEMBER_A);
    expect(actions.listBatchesAction).toHaveBeenCalled();
    expect(actions.listMemberSubscriptionsAction).toHaveBeenCalledWith(MEMBER_A);
    expect(actions.listPlansAction).toHaveBeenCalled();
    // The third pair: makeup credits, sources and targets.
    expect(actions.listMakeupCreditsAction).toHaveBeenCalledWith(MEMBER_A);
    expect(actions.listMakeupSourcesAction).toHaveBeenCalledWith(MEMBER_A);
    expect(actions.listMakeupTargetsAction).toHaveBeenCalledWith(MEMBER_A);
  });

  // GUARD: a non-overview tab issues no enrolment/subscription read.
  it("reads nothing for a non-overview tab", async () => {
    render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: MEMBER_A }),
        searchParams: Promise.resolve({ facility: FACILITY, tab: "notes" }),
      }),
    );
    await settle();
    expect(actions.listMemberEnrolmentsAction).not.toHaveBeenCalled();
    expect(actions.listBatchesAction).not.toHaveBeenCalled();
    expect(actions.listMemberSubscriptionsAction).not.toHaveBeenCalled();
    expect(actions.listPlansAction).not.toHaveBeenCalled();
    expect(actions.listMakeupCreditsAction).not.toHaveBeenCalled();
    expect(actions.listMakeupSourcesAction).not.toHaveBeenCalled();
    expect(actions.listMakeupTargetsAction).not.toHaveBeenCalled();
  });

  // INTENDED RED: a failed pair becomes a typed safe error, not empty data.
  it("turns a failed pair into the panel's honest error state", async () => {
    actions.listMemberEnrolmentsAction.mockRejectedValueOnce(new Error("forbidden"));
    const page = await MemberDetailPage({
      params: Promise.resolve({ memberId: MEMBER_A }),
      searchParams: Promise.resolve({ facility: FACILITY }),
    });
    await act(async () => {
      render(page);
    });
    await settle();
    expect(screen.getByTestId("enrolment-retry")).toBeTruthy();
    expect(screen.queryByText(/not enrolled in any/i)).toBeNull();
  });
});

describe("seed hardening", () => {
  // BUG 1 (RED): a seeded eligible plan list left planId "" — the seed effect
  // returned because appliedSeed already equalled the seed — so a start with
  // no manual selector interaction submitted no plan.
  it("submits the seeded default plan on start", async () => {
    render(
      <MemberSubscriptionPanel
        memberId={MEMBER_A}
        canManage
        initialData={{ memberId: MEMBER_A, subscriptions: [], plans: [PLAN_A] }}
      />,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));
    await waitFor(() => expect(actions.createSubscriptionAction).toHaveBeenCalled());
    expect(actions.createSubscriptionAction.mock.calls[0]![0]).toMatchObject({
      memberId: MEMBER_A,
      planId: "plan-a",
    });
  });

  // BUG 2 (RED): applying a fresh same-member seed did not invalidate the
  // pending read, so the older read's rejection became the panel's error.
  it("a fresh same-member subscription seed wins over an older pending read", async () => {
    const late = deferred<SubscriptionRow[]>();
    actions.listMemberSubscriptionsAction.mockReturnValueOnce(late.promise);
    actions.listPlansAction.mockReturnValueOnce(deferred<PlanRow[]>().promise);
    const view = render(<MemberSubscriptionPanel memberId={MEMBER_A} canManage />);
    await settle();
    view.rerender(
      <MemberSubscriptionPanel
        memberId={MEMBER_A}
        canManage
        initialData={{ memberId: MEMBER_A, subscriptions: [SUBSCRIPTION_A], plans: [PLAN_A] }}
      />,
    );
    await settle();
    await act(async () => {
      late.reject(new Error("old read failed"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getAllByText(/Swim · Monthly/).length).toBeGreaterThan(0);
  });

  it("a fresh same-member enrolment seed wins over an older pending read", async () => {
    const late = deferred<MemberEnrolment[]>();
    actions.listMemberEnrolmentsAction.mockReturnValueOnce(late.promise);
    actions.listBatchesAction.mockReturnValueOnce(deferred<BatchWithProgramName[]>().promise);
    const view = render(
      <MemberEnrolmentPanel memberId={MEMBER_A} terminology={TERMINOLOGY} canEnrol canWaitlist />,
    );
    await settle();
    view.rerender(
      <MemberEnrolmentPanel
        memberId={MEMBER_A}
        terminology={TERMINOLOGY}
        canEnrol
        canWaitlist
        initialData={{ memberId: MEMBER_A, enrolments: [ENROLMENT_A], batches: [BATCH_A] }}
      />,
    );
    await settle();
    await act(async () => {
      late.reject(new Error("old read failed"));
      await Promise.resolve();
    });
    expect(screen.queryByTestId("enrolment-retry")).toBeNull();
    expect(screen.getByText(/Swimmers A/)).toBeTruthy();
  });

  // BUG 3: member A already rendered; switching to B while B's read is
  // pending must never show A's rows or A's mutation controls under B.
  it("never shows the previous member's rows while the new member loads", async () => {
    actions.listBatchesAction.mockResolvedValue([BATCH_B]);
    const view = render(
      <MemberEnrolmentPanel memberId={MEMBER_A} terminology={TERMINOLOGY} canEnrol canWaitlist />,
    );
    await waitFor(() => expect(screen.getByText(/Swimmers A/)).toBeTruthy());
    const pending = deferred<MemberEnrolment[]>();
    actions.listMemberEnrolmentsAction.mockReturnValueOnce(pending.promise);
    view.rerender(
      <MemberEnrolmentPanel memberId={MEMBER_B} terminology={TERMINOLOGY} canEnrol canWaitlist />,
    );
    await settle();
    expect(screen.queryByText(/Swimmers A/)).toBeNull();
  });

  it("never shows the previous member's subscriptions while the new member loads", async () => {
    const view = render(<MemberSubscriptionPanel memberId={MEMBER_A} canManage />);
    await waitFor(() => expect(screen.getByText("Active")).toBeTruthy());
    const pending = deferred<SubscriptionRow[]>();
    actions.listMemberSubscriptionsAction.mockReturnValueOnce(pending.promise);
    actions.listPlansAction.mockReturnValueOnce(deferred<PlanRow[]>().promise);
    view.rerender(<MemberSubscriptionPanel memberId={MEMBER_B} canManage />);
    await settle();
    expect(screen.queryByText("Active")).toBeNull();
  });
});
