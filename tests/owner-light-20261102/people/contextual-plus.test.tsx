// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the approved contextual "+"
// and the duplicate empty-list create action.
//
// 1. Staff access (invitations) uses the SAME shared create action as Staff
//    and Members: one accessible "Invite staff" action (phone floating, desktop
//    labelled), same href, same staff.invite gate.
// 2. The enquiries board's inline Add-enquiry toggle shows the approved
//    outline plus beside its label while collapsed; the expanded Close state
//    must not show a misleading plus.
// 3. The members directory's empty list keeps its honest explanation but no
//    longer repeats a second "Add your first member" action — the header owns
//    the single create action.
//
// No database: every action is stubbed.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  listInvitationsAction: vi.fn(async () => []),
  listMembersAction: vi.fn(async () => []),
  createEnquiryAction: vi.fn(async () => ({ ok: false, error: "not used" })),
  searchPersonsAction: vi.fn(async () => []),
}));
const ctx = vi.hoisted(() => ({ permissions: new Set<string>(["staff.invite", "staff.read"]) }));

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
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: ctx.permissions,
    features: new Set(["staff"]),
  }),
  requirePagePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new Error(`forbidden: ${key}`);
    return ctx;
  },
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: () => true,
  hasFeature: () => false,
}));
vi.mock("@/lib/actions/staff-invitations", () => ({
  listInvitationsAction: actions.listInvitationsAction,
  createInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: actions.listMembersAction,
  createEnquiryAction: actions.createEnquiryAction,
  searchPersonsAction: actions.searchPersonsAction,
}));
vi.mock("@/lib/actions/enquiries", () => ({
  createEnquiryAction: actions.createEnquiryAction,
  markEnquiryContactedAction: vi.fn(),
  convertEnquiryAction: vi.fn(),
  updateEnquiryStatusAction: vi.fn(),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import StaffInvitationsPage from "@/app/(owner)/owner/staff/invitations/page";
import { MembersBoard } from "@/components/members-board";
import { EnquiriesBoard } from "@/components/enquiries-board";

const FACILITY = "22222222-2222-4222-8222-222222222222";

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  // The owner's capture brings its name field into view when it opens.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

beforeEach(() => {
  for (const spy of Object.values(actions)) spy.mockReset();
  actions.listInvitationsAction.mockResolvedValue([]);
  actions.listMembersAction.mockResolvedValue([]);
  ctx.permissions = new Set(["staff.invite", "staff.read"]);
});

afterEach(cleanup);

describe("the staff access create action", () => {
  // RED: the header still renders its own plain link.
  it("uses the shared Invite staff action", async () => {
    render(await StaffInvitationsPage());
    const add = screen.queryAllByRole("link", { name: "Invite staff" });
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute("href")).toBe("/owner/staff/invitations/new");
    expect(add[0]!.hasAttribute("data-owner-create-action")).toBe(true);
    expect(add[0]!.querySelector("svg path")?.getAttribute("d")).toBe(
      "M12 5v14M5 12h14",
    );
  });

  // CONTROL: no invite affordance without staff.invite.
  it("offers no create action without staff.invite", async () => {
    ctx.permissions = new Set(["staff.read"]);
    await expect(StaffInvitationsPage()).rejects.toThrow(/forbidden: staff.invite/);
  });
});

describe("the enquiries board's inline toggle", () => {
  // RED: the collapsed toggle has no plus.
  it("shows the approved plus beside the collapsed label", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[]}
        locations={[{ id: FACILITY, name: "Worli Main" }]}
        canWrite
        variant="oversight"
      />,
    );
    const toggle = screen.getByRole("button", { name: "Add enquiry" });
    expect(toggle.querySelector("svg path")?.getAttribute("d")).toBe(
      "M12 5v14M5 12h14",
    );
  });

  // CONTROL: the expanded Close state carries no misleading plus.
  it("does not show a plus in the expanded close state", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[]}
        locations={[{ id: FACILITY, name: "Worli Main" }]}
        canWrite
        variant="oversight"
      />,
    );
    const toggle = screen.getByRole("button", { name: "Add enquiry" });
    fireEvent.click(toggle);
    const close = screen.getByRole("button", { name: "Close enquiry capture" });
    expect(close.querySelector("svg")).toBeNull();
  });
});

describe("the members directory's empty list", () => {
  // RED: the empty list repeats a second create action.
  it("keeps the honest explanation without a second create action", () => {
    render(
      <MembersBoard
        initialMembers={[]}
        initialLocationId={FACILITY}
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const list = screen.getByTestId("members-list");
    expect(within(list).queryAllByRole("link", { name: /add/i })).toHaveLength(0);
    expect(list.textContent).toMatch(/No .* yet/i);
  });

  // CONTROL: a filtered empty list keeps the no-match distinction.
  it("keeps the no-match distinction for a filtered empty list", () => {
    render(
      <MembersBoard
        initialMembers={[]}
        initialLocationId={FACILITY}
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const search = screen.getByTestId("members-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByTestId("members-list").textContent).toMatch(/No .* match/i);
  });
});
