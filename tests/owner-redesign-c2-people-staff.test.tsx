// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — the staff access surfaces.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
//   1. The leave queue was one undifferentiated list, so a pending
//      decision was not separated from a decided request, and each
//      decided row printed the raw database state ("approved").
//   2. The staff profile page and the staff directory said the same
//      thing in different words ("Has login" / "No login" against
//      "Login access · Active" / "No access"), so the directory and
//      the profile did not read as one surface.
//   3. The invitations list hand-rolled its empty state instead of the
//      shared one, so the list did not have the shared empty shape.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    roleKey: "owner",
    permissions: new Set(["staff.read", "staff.roster", "settings.manage"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: vi.fn(async () => []),
}));

vi.mock("@/lib/actions/leave", () => ({
  listLeaveTypesAction: vi.fn(async () => []),
  listLeaveRequestsAction: vi.fn(async () => []),
  listUncoveredSessionsAction: vi.fn(async () => []),
  approveLeaveRequestAction: vi.fn(),
  rejectLeaveRequestAction: vi.fn(),
  createLeaveTypeAction: vi.fn(),
  updateLeaveTypeAction: vi.fn(),
}));

vi.mock("@/lib/services/curriculum-lead", () => ({
  getCurriculumLeadState: vi.fn(async () => null),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("not found");
  },
}));

import StaffLeavePage from "@/app/(owner)/owner/staff/leave/page";
import StaffDetailPage from "@/app/(owner)/owner/staff/[staffId]/page";
import { InvitationsBoard } from "@/components/invitations-board";
import { StaffBoard } from "@/components/staff-board";
import { listLeaveRequestsAction } from "@/lib/actions/leave";
import { listStaffAction } from "@/lib/actions/staff";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";
import type { StaffRow } from "@/lib/services/staff";

const REQUESTS = [
  {
    id: "r2",
    staffName: "Bhaskar Menon",
    leaveTypeName: "Casual leave",
    days: 1,
    fromDate: "2026-10-30",
    toDate: "2026-10-30",
    reason: "Family function",
    status: "approved",
    decisionNote: "Approved 18 Oct",
    decidedAt: "2026-10-18T04:00:00.000Z",
  },
  {
    id: "r1",
    staffName: "Rhea Jain",
    leaveTypeName: "Casual leave",
    days: 1,
    fromDate: "2026-11-04",
    toDate: "2026-11-04",
    reason: null,
    status: "pending",
    decisionNote: null,
    decidedAt: null,
  },
];

const STAFF = [
  {
    id: "s1",
    personId: "person-1",
    fullName: "Aanya Rao",
    userId: "user-1",
    staffType: "coach",
    employedOn: "2026-06-01",
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("leave queue (C2)", () => {
  it("separates the pending decisions from the previous decisions", async () => {
    vi.mocked(listLeaveRequestsAction).mockResolvedValue(REQUESTS as never);
    render(await StaffLeavePage());

    const headings = Array.from(document.querySelectorAll("h2")).map(
      (heading) => heading.textContent ?? "",
    );
    const pendingIndex = headings.findIndex((h) => /pending/i.test(h));
    const decidedIndex = headings.findIndex((h) => /previous/i.test(h));

    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(decidedIndex).toBeGreaterThanOrEqual(0);
    expect(pendingIndex).toBeLessThan(decidedIndex);
  });

  it("states a decided request in a readable word", async () => {
    vi.mocked(listLeaveRequestsAction).mockResolvedValue(REQUESTS as never);
    render(await StaffLeavePage());

    const text = document.body.textContent ?? "";
    expect(text).toContain("Approved");
    // The raw database state must not appear as a standalone element.
    const raw = Array.from(document.querySelectorAll("*")).filter(
      (element) =>
        element.children.length === 0 &&
        (element.textContent ?? "").trim() === "approved",
    );
    expect(raw).toHaveLength(0);
  });

  it("keeps the original request reason in the decided history", async () => {
    // P3 (independent review) — the decided history must still show
    // WHY the leave was asked for, not only the decision note.
    vi.mocked(listLeaveRequestsAction).mockResolvedValue(REQUESTS as never);
    render(await StaffLeavePage());

    expect(document.body.textContent ?? "").toContain("Family function");
  });
});

describe("staff profile (C2)", () => {
  it("states login access in the same words as the directory", async () => {
    vi.mocked(listStaffAction).mockResolvedValue(STAFF as never);
    render(await StaffDetailPage({ params: Promise.resolve({ staffId: "s1" }) }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("Login access");
    expect(text).toContain("Linked");
    expect(text).not.toContain("Has login");
  });

  it("never infers an active login from a linked identity", async () => {
    // P2 (independent review) — revokeInvitation leaves staff.userId in
    // place while the tenant membership becomes "revoked", so a linked
    // identity is NOT an active login. The surface must say what it
    // knows (the identity is linked) and point at the surface that
    // holds the access state.
    vi.mocked(listStaffAction).mockResolvedValue(STAFF as never);
    render(await StaffDetailPage({ params: Promise.resolve({ staffId: "s1" }) }));

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bActive\b/);
    expect(text).toMatch(/invitations/i);
  });
});

describe("staff directory (C2)", () => {
  it("never infers an active login from a linked identity", () => {
    const row = {
      id: "s1",
      personId: "person-1",
      fullName: "Aanya Rao",
      userId: "user-1",
      staffType: "coach",
      employedOn: "2026-06-01",
    } as unknown as StaffRow;
    render(<StaffBoard rows={[row]} />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Linked");
    expect(text).not.toMatch(/\bActive\b/);
  });
});

describe("invitations list (C2)", () => {
  it("uses the shared empty state", () => {
    render(<InvitationsBoard rows={[]} />);
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("states the invitation state with a readable word", () => {
    const row = {
      membershipId: "m1",
      phone: "+919000000001",
      status: "invited",
      roleKey: "coach",
      locationNames: [],
      fullName: "Aanya Rao",
      acceptedAt: null,
    } as unknown as ListInvitationsRow;
    render(<InvitationsBoard rows={[row]} />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Invited");
  });
});
