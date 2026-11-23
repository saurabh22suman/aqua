// @vitest-environment jsdom
//
// finish/staff — the remaining club-facing staff workflows.
//
// These are isolated, mocked render tests. They pin the workflow
// decisions the lane changed: a curriculum read/save failure keeps the
// page usable, the account surfaces put today's check-in before display
// settings, a worker is never told an ended shift is next, the worker
// inbox recovers like the other staff inboxes, the member achievements
// page uses the family publication vocabulary, the parent explainer
// states the real next step, and the café counter separates a failed
// read from an empty list. They are not browser proof.

import { asMemberId } from "@/lib/ids";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRow } from "@/lib/services/announcements";
import type { LeaveBalanceRow, LeaveRequestRow, LeaveTypeRow } from "@/lib/services/leave";
import type { OpenCafeOrderRow } from "@/lib/services/cafe-billing";
import type { MyShiftRow } from "@/lib/services/shifts";
import type { MyAttendanceRow } from "@/lib/services/staff-attendance";
import type { SkillLadderRow } from "@/lib/services/skill-ladder";
import type {
  ShowcaseState,
  ShowcaseSubjectState,
} from "@/lib/services/showcase/state";
import { todayInZone } from "@/lib/time/tz";

const state = vi.hoisted(() => ({
  roleKey: "coach",
  tenantId: "tenant-a",
  userId: "user-a",
  permissions: new Set<string>(),
  features: new Set<string>(),
  failSelfService: false,
  failLeaveTypes: false,
  shifts: [] as MyShiftRow[],
  attendance: null as MyAttendanceRow | null,
  leaveTypes: [] as LeaveTypeRow[],
  myLeave: {
    balances: [] as LeaveBalanceRow[],
    requests: [] as LeaveRequestRow[],
  },
  notices: [] as NotificationRow[],
  noticesFail: false,
  ladders: [] as SkillLadderRow[],
  ladderReadFail: false,
  ladderSaveFail: false,
  showcaseReadFail: false,
  showcase: null as ShowcaseState | null,
  openOrders: [] as OpenCafeOrderRow[],
  openOrdersFail: false,
  menuFail: false,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({
    tenantId: state.tenantId,
    userId: state.userId,
    roleKey: state.roleKey,
    permissions: state.permissions,
    features: state.features,
  }),
  NotFoundError: class NotFoundError extends Error {},
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireCoach: async () => ({}),
  requireReception: async () => ({}),
  requirePagePermission: () => {},
}));

vi.mock("@/lib/auth/permission", () => ({
  hasFeature: (_ctx: unknown, key: string) => state.features.has(key),
  hasPermission: (_ctx: unknown, key: string) => state.permissions.has(key),
  requirePermission: () => {},
}));

vi.mock("@/lib/services/staff", () => ({
  getCurrentStaffIdentity: async () => ({
    fullName: "Asha Rao",
    phone: "+919000000001",
  }),
}));

vi.mock("@/lib/actions/shifts", () => ({
  listMyShiftsAction: async () => {
    if (state.failSelfService) throw new Error("shifts unavailable");
    return state.shifts;
  },
}));

vi.mock("@/lib/actions/staff-attendance", () => ({
  getMyAttendanceAction: async () => {
    if (state.failSelfService) throw new Error("attendance unavailable");
    return state.attendance;
  },
}));

vi.mock("@/lib/actions/leave", () => ({
  listLeaveTypesAction: async () => {
    if (state.failSelfService || state.failLeaveTypes) throw new Error("leave unavailable");
    return state.leaveTypes;
  },
  listMyLeaveAction: async () => {
    if (state.failSelfService) throw new Error("leave unavailable");
    return state.myLeave;
  },
}));

vi.mock("@/lib/actions/skill-ladder", () => ({
  listSkillLaddersAction: async () => {
    if (state.ladderReadFail) throw new Error("ladders unavailable");
    return state.ladders;
  },
  updateSkillLevelAction: async () => {
    if (state.ladderSaveFail) throw new Error("save failed");
    return { ok: true, id: "level-1" };
  },
  updateSkillNodeAction: async () => {
    if (state.ladderSaveFail) throw new Error("save failed");
    return { ok: true, id: "skill-1" };
  },
}));

vi.mock("@/lib/actions/orders", () => ({
  listOpenCafeOrdersAction: async () => {
    if (state.openOrdersFail) throw new Error("orders unavailable");
    return state.openOrders;
  },
  requestCafeBillAction: vi.fn(),
}));

vi.mock("@/lib/actions/menu", () => ({
  listMenuAction: async () => {
    if (state.menuFail) throw new Error("menu unavailable");
    return {
      categories: [],
      items: [],
      taxRegistered: true,
      taxRegistrationByLocation: {},
    };
  },
}));

vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [],
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/terminology/staff-terms", () => ({
  staffTerminology: (value: unknown) => value,
}));

vi.mock("@/lib/services/announcements", () => ({
  listMyNotifications: async () => {
    if (state.noticesFail) throw new Error("inbox unavailable");
    return state.notices;
  },
}));

vi.mock("@/lib/auth/self-scope", () => ({
  resolveScopedSelfScope: async () => ({
    read: async () => {
      if (state.showcaseReadFail) throw new Error("publication unavailable");
      return state.showcase;
    },
  }),
}));

vi.mock("@/lib/services/showcase/state", () => ({
  readShowcaseState: vi.fn(),
}));

vi.mock("@/components/my-shifts-card", () => ({
  MyShiftsCard: () => <p>MY SHIFTS</p>,
}));

vi.mock("@/components/my-attendance-card", () => ({
  MyAttendanceCard: ({ id }: { id?: string }) => (
    <div id={id}>MY ATTENDANCE</div>
  ),
}));

vi.mock("@/components/my-leave-card", () => ({
  MyLeaveCard: () => <p>MY LEAVE</p>,
}));

vi.mock("@/components/tenant-sign-out", () => ({
  TenantSignOut: () => <button type="button">Sign out</button>,
}));

vi.mock("@/components/staff-club-install-link", () => ({
  StaffClubInstallLink: () => null,
}));

vi.mock("@/components/staff-ui/staff-appearance", () => ({
  StaffAppearance: () => <p>APPEARANCE</p>,
}));

vi.mock("@/components/announcements/staff-inbox-link", () => ({
  StaffInboxLink: ({ href }: { href: string }) => (
    <a href={href}>Announcements</a>
  ),
}));

vi.mock("@/components/announcements/notification-inbox", () => ({
  NotificationInbox: ({ initial }: { initial: NotificationRow[] }) => (
    <p>{initial.length} notices</p>
  ),
}));

vi.mock("@/components/onboarding/guide-help-button", () => ({
  OpenWorkspaceGuideLink: () => null,
  GuideHelpButton: () => null,
}));

vi.mock("@/components/onboarding/optional-workspace-guide", () => ({
  OptionalWorkspaceGuide: () => null,
}));

vi.mock("@/components/onboarding/guide-preference-key", () => ({
  guidePreferenceKey: () => "guide-key",
}));

vi.mock("@/components/cafe-open-orders", () => ({
  CafeOpenOrders: ({ orders }: { orders: unknown[] }) => (
    <p>OPEN ORDERS {orders.length}</p>
  ),
}));

vi.mock("@/components/cafe-order-screen", () => ({
  CafeOrderScreen: () => <p>ORDER SCREEN</p>,
}));

import CoachCurriculumPage from "@/app/(coach)/coach/curriculum/page";
import { StaffWorkdayPage } from "@/components/staff-ui/staff-workday-page";
import CoachWorkdayPage from "@/app/(coach)/coach/workday/page";
import ReceptionWorkdayPage from "@/app/(reception)/reception/workday/page";
import CoachMePage from "@/app/(coach)/coach/me/page";
import ReceptionMePage from "@/app/(reception)/reception/me/page";
import ReceptionCafePage from "@/app/(reception)/reception/cafe/page";
import MemberShowcasePage from "@/app/(self)/member/showcase/page";
import WorkerHomePage from "@/app/(worker)/worker/page";
import WorkerLeavePage from "@/app/(worker)/worker/leave/page";
import WorkerShiftsPage from "@/app/(worker)/worker/shifts/page";
import WorkerMePage from "@/app/(worker)/worker/me/page";
import { StaffInboxPage } from "@/components/announcements/staff-inbox-page";
import { SkillLadderManager } from "@/components/skill-ladder-manager";
import { ParentLinkExplainer } from "@/components/parent-link-explainer";

const LADDER_ID = "11111111-1111-4111-8111-111111111111";
const LEVEL_ID = "22222222-2222-4222-8222-222222222222";
const SKILL_ID = "33333333-3333-4333-8333-333333333333";

const LADDER: SkillLadderRow = {
  id: LADDER_ID,
  activityTypeKey: "swim",
  name: "Swimming",
  nodes: [
    {
      id: LEVEL_ID,
      parentId: null,
      name: "Level 1",
      ordinal: 1,
      rubric: {},
    },
    {
      id: SKILL_ID,
      parentId: LEVEL_ID,
      name: "Float",
      ordinal: 1,
      rubric: { "1": "", "2": "", "3": "", "4": "" },
    },
  ],
};

const SUBJECT: ShowcaseSubjectState = {
  memberId: asMemberId("44444444-4444-4444-8444-444444444444"),
  role: "subject",
  isMinor: false,
  state: "private",
  reason: "No decision yet — nothing is published.",
  chosenName: null,
  allowedActions: ["approve", "revoke"],
  publicPath: null,
  lastSubjectAction: null,
};

beforeEach(() => {
  state.roleKey = "coach";
  state.permissions = new Set<string>();
  state.features = new Set<string>();
  state.failSelfService = false;
  state.failLeaveTypes = false;
  state.shifts = [];
  state.attendance = null;
  state.leaveTypes = [];
  state.myLeave = { balances: [], requests: [] };
  state.notices = [];
  state.noticesFail = false;
  state.ladders = [LADDER];
  state.ladderReadFail = false;
  state.ladderSaveFail = false;
  state.showcaseReadFail = false;
  state.showcase = { audience: "member", subjects: [SUBJECT] };
  state.openOrders = [];
  state.openOrdersFail = false;
  state.menuFail = false;
});

afterEach(cleanup);

describe("finish/staff curriculum", () => {
  it("keeps the curriculum page usable when the ladder read fails", async () => {
    state.permissions = new Set(["levels.read"]);
    state.features = new Set(["swim.levels"]);
    state.ladderReadFail = true;

    render(await CoachCurriculumPage());

    expect(screen.getByRole("alert").textContent).toMatch(
      /could not load the curriculum/i,
    );
    expect(
      screen.getByRole("link", { name: "Retry curriculum" }).getAttribute("href"),
    ).toBe("/coach/curriculum");
  });

  it("restores the save control and states the failure when a skill save is refused", async () => {
    state.ladderSaveFail = true;

    render(<SkillLadderManager ladders={[LADDER]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /could not save/i,
    );
    const save = screen.getByRole("button", {
      name: "Save skill",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });
});

describe("finish/staff account surfaces", () => {
  it.each([
    ["coach", CoachMePage],
    ["receptionist", ReceptionMePage],
  ] as const)(
    "keeps workday actions one step from %s account settings",
    async (role, Page) => {
      state.roleKey = role;
      state.permissions = new Set(["members.read", "staff.self"]);
      render(await Page());
      const base = role === "coach" ? "/coach" : "/reception";
      expect(screen.getByRole("link", { name: "My workday" }).getAttribute("href")).toBe(`${base}/workday`);
      expect(screen.queryByText("MY ATTENDANCE")).toBeNull();
      expect(screen.getByText("APPEARANCE")).toBeTruthy();
    },
  );

  it.each([
    ["coach", CoachWorkdayPage, "/coach/workday"],
    ["receptionist", ReceptionWorkdayPage, "/reception/workday"],
  ] as const)(
    "offers %s a retry instead of empty work cards when the self-service reads fail",
    async (role, Page, retryHref) => {
      state.roleKey = role;
      state.failSelfService = true;

      render(await StaffWorkdayPage((await Page()).props));

      expect(screen.getByRole("alert").textContent).toMatch(
        /could not load your work details/i,
      );
      expect(
        screen.getByRole("link", { name: "Retry work details" }).getAttribute(
          "href",
        ),
      ).toBe(retryHref);
      expect(screen.queryByText("MY ATTENDANCE")).toBeNull();
    },
  );
});

describe("finish/staff worker workday", () => {
  it("keeps attendance on Today and gives shifts and profile their own pages", async () => {
    state.roleKey = "worker";
    state.permissions = new Set(["staff.self"]);

    const today = render(await WorkerHomePage());

    expect(document.getElementById("today-attendance")).not.toBeNull();
    expect(screen.queryByText("MY SHIFTS")).toBeNull();
    expect(screen.queryByRole("link", { name: "Check in below" })).toBeNull();
    today.unmount();

    const shifts = render(await WorkerShiftsPage());
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Leave" }).getAttribute("href")).toBe("/worker/leave");
    expect(screen.getByText("MY SHIFTS")).toBeTruthy();
    expect(screen.queryByText("MY ATTENDANCE")).toBeNull();
    shifts.unmount();

    render(await WorkerMePage());
    expect(screen.getByRole("heading", { name: "Me" })).toBeTruthy();
    expect(screen.queryByText("MY ATTENDANCE")).toBeNull();
  });

  it("does not call an already-ended shift the next shift", async () => {
    state.roleKey = "worker";
    state.permissions = new Set(["staff.self"]);
    const today = todayInZone("Asia/Kolkata");
    const now = Date.now();
    state.shifts = [
      {
        id: "shift-1",
        staffId: "staff-1",
        locationId: "loc-1",
        shiftDate: today,
        startAt: new Date(now - 2 * 3_600_000).toISOString(),
        endAt: new Date(now - 3_600_000).toISOString(),
        status: "published",
      },
    ];

    render(await WorkerHomePage());

    expect(
      screen.getByRole("heading", { name: "No upcoming shift" }),
    ).toBeTruthy();
    expect(screen.queryByText("Next shift")).toBeNull();
  });

  it("offers a retry rather than a false not-checked-in state when reads fail", async () => {
    state.roleKey = "worker";
    state.permissions = new Set(["staff.self"]);
    state.failSelfService = true;

    render(await WorkerHomePage());

    expect(screen.getByRole("alert").textContent).toMatch(
      /could not load your work details/i,
    );
    expect(screen.queryByText("Not checked in")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Retry work details" }).getAttribute(
        "href",
      ),
    ).toBe("/worker");
  });

  it("gives a worker inbox the same return and read-error recovery as other staff", async () => {
    state.roleKey = "worker";
    state.noticesFail = true;

    render(await StaffInboxPage({ surface: "worker" }));

    expect(
      screen.getByRole("link", { name: "Back to My workday" }).getAttribute(
        "href",
      ),
    ).toBe("/worker");
    expect(screen.getByRole("alert").textContent).toMatch(
      /could not load announcements/i,
    );
    expect(
      screen.getByRole("link", { name: "Retry announcements" }).getAttribute(
        "href",
      ),
    ).toBe("/worker/announcements");
  });
});

describe("finish/staff member achievements page", () => {
  it("uses the family publication vocabulary and keeps the fixed-name warning", async () => {
    render(
      await MemberShowcasePage({ searchParams: Promise.resolve({}) }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Achievements page" }),
    ).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Publish my page" }),
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(/cannot be changed/i);
  });

  it("still lets a published member take the page down", async () => {
    state.showcase = {
      audience: "member",
      subjects: [
        {
          ...SUBJECT,
          state: "public",
          reason: "This page is public.",
          chosenName: "Aarav",
          publicPath: "/showcase/token",
        },
      ],
    };

    render(
      await MemberShowcasePage({ searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText("Public")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Take my page down" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View public page" }).getAttribute("href"),
    ).toBe("/showcase/token");
  });

  it("shows a retry instead of failing the page when the publication read fails", async () => {
    state.showcaseReadFail = true;

    render(
      await MemberShowcasePage({ searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByRole("alert").textContent).toMatch(
      /could not load your achievements page/i,
    );
    expect(
      screen.getByRole("link", { name: "Retry achievements page" }).getAttribute(
        "href",
      ),
    ).toBe("/member/showcase");
  });
});

describe("finish/staff parent explainer", () => {
  it("gives the parent a real next step and keeps staff sign-in in its own group", () => {
    render(<ParentLinkExplainer />);

    expect(
      screen.getByRole("heading", { name: "Open the private link from your club" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Family sign in" }).getAttribute("href")).toBe("/family/sign-in");
    const staff = screen.getByRole("region", { name: "Club staff" });
    expect(
      staff.querySelector('a[href="/login"]')?.textContent,
    ).toMatch(/staff sign in/i);
  });
});

describe("finish/staff café counter", () => {
  it("keeps the new-order half available when open orders fail to load", async () => {
    state.roleKey = "receptionist";
    state.permissions = new Set(["payments.record"]);
    state.features = new Set(["cafe.pos"]);
    state.openOrdersFail = true;

    render(await ReceptionCafePage());

    expect(screen.getByRole("alert").textContent).toMatch(
      /could not load open orders/i,
    );
    expect(
      screen.getByRole("link", { name: "Retry open orders" }).getAttribute(
        "href",
      ),
    ).toBe("/reception/cafe");
    expect(screen.getByText("ORDER SCREEN")).toBeTruthy();
  });

  it("names the new counter order and explains when its reads fail", async () => {
    state.roleKey = "receptionist";
    state.permissions = new Set(["payments.record"]);
    state.features = new Set(["cafe.pos"]);
    state.menuFail = true;

    render(await ReceptionCafePage());

    expect(
      screen.getByRole("heading", { name: "New counter order unavailable" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(
      /new counter order couldn't load/i,
    );
    expect(
      screen.getByRole("link", { name: "Retry new counter order" }),
    ).toBeTruthy();
  });
});

it.each([
  ["coach", CoachWorkdayPage, "/coach/workday"],
  ["receptionist", ReceptionWorkdayPage, "/reception/workday"],
] as const)("audit priority lets %s check in when leave types fail", async (role, Page, href) => {
  state.roleKey = role;
  state.permissions = new Set(["staff.self"]);
  state.failLeaveTypes = true;

  render(await StaffWorkdayPage((await Page()).props));

  expect(screen.getByText("MY ATTENDANCE")).toBeTruthy();
  expect(screen.getByText("MY SHIFTS")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Retry leave" }).getAttribute("href")).toBe(href);
});

it("keeps Worker Today open when the separate Leave read fails", async () => {
  state.roleKey = "worker";
  state.permissions = new Set(["staff.self"]);
  state.failLeaveTypes = true;
  const today = render(await WorkerHomePage());
  expect(screen.getByText("MY ATTENDANCE")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Retry leave" })).toBeNull();
  today.unmount();
  render(await WorkerLeavePage());
  expect(screen.getByRole("link", { name: "Retry leave" }).getAttribute("href")).toBe("/worker/leave");
  expect(screen.queryByText("MY ATTENDANCE")).toBeNull();
});
