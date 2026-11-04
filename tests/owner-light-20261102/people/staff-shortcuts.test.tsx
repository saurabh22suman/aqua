// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the approved Staff
// "Shortcuts" layout.
//
// Human choice (3 Nov): the SHORTCUTS alternative, not Tabs. The approved
// reference (`staff-approved-shortcuts-reference.html`,
// `section[data-variant="Shortcuts"]`) draws THREE equal compact shortcut
// columns above the directory — a soft icon tile over a plain caption, no
// outlined button cages — and the create affordance is the shared floating
// action ("Add staff").
//
// INTENDED RED (this file): the page still renders its outlined toolbar
// (Roster / Invitations / Leave / Check-in QR as button-shaped links) and
// therefore no semantic "Staff shortcuts" nav with the approved glyphs, and
// it still duplicates Check-in QR at the root.
//
// No database: the pages' actions are stubbed.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

const ctx = vi.hoisted(() => ({
  permissions: new Set<string>(["staff.read", "staff.write", "staff.roster"]),
  roleKey: "owner",
}));
const gates = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: ctx.permissions,
    features: new Set<string>(),
    roleKey: ctx.roleKey,
  }),
  requirePagePermission: (value: unknown, permission?: string) => {
    if (permission) gates.push(permission);
    return value;
  },
}));

vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: async () => [
    {
      id: "staff-1",
      personId: "person-1",
      fullName: "Aanya Rao",
      staffType: "coach",
      userId: "user-1",
      employedOn: "2026-06-01",
    },
  ],
  listShiftTemplatesAction: async () => [],
  createShiftAction: async () => ({ ok: true }),
  createShiftTemplateAction: async () => ({ ok: true }),
  deleteShiftAction: async () => ({ ok: true }),
  publishRosterAction: async () => ({ ok: true }),
}));

vi.mock("@/lib/actions/shifts", () => ({
  listRosterWeekAction: async () => [],
  listShiftTemplatesAction: async () => [],
  createShiftAction: async () => ({ ok: true }),
  createShiftTemplateAction: async () => ({ ok: true }),
  deleteShiftAction: async () => ({ ok: true }),
  publishRosterAction: async () => ({ ok: true }),
}));

vi.mock("@/lib/actions/tenant-owner-reset", () => ({
  listOwnerMembershipsAction: async () => [],
}));

vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

import StaffListPage from "@/app/(owner)/owner/staff/page";
import StaffRosterPage from "@/app/(owner)/owner/staff/roster/page";

const SHORTCUTS = [
  ["Roster", "/owner/staff/roster"],
  ["Invitations", "/owner/staff/invitations"],
  ["Leave", "/owner/staff/leave"],
] as const;

beforeEach(() => {
  ctx.permissions = new Set(["staff.read", "staff.write", "staff.roster"]);
  ctx.roleKey = "owner";
  gates.length = 0;
});

afterEach(cleanup);

describe("the approved Staff shortcuts", () => {
  // RED: the page renders an outlined toolbar, not the approved semantic
  // shortcut nav.
  it("renders a labelled three-link shortcut nav", async () => {
    render(await StaffListPage());

    const nav = screen.queryByRole("navigation", { name: "Staff shortcuts" });
    expect(nav, "no Staff shortcuts navigation").toBeTruthy();

    const links = within(nav!).getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const [label, href] of SHORTCUTS) {
      const link = within(nav!).getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
      // A soft icon tile above the caption, not an outlined button cage.
      expect(link.querySelector("svg"), `${label} has no glyph`).toBeTruthy();
    }
  });

  // RED: the approved glyphs — the list, the user-plus and the calendar.
  // The roster and the leave shortcut drew the SAME calendar, so two
  // different destinations looked alike.
  it("draws the approved shortcut glyphs", async () => {
    render(await StaffListPage());
    const nav = screen.getByRole("navigation", { name: "Staff shortcuts" });

    const roster = within(nav).getByRole("link", { name: "Roster" });
    expect(
      roster.querySelector("svg path")?.getAttribute("d"),
    ).toContain("M4 6.5h16M4 12h16");

    const invitations = within(nav).getByRole("link", { name: "Invitations" });
    expect(
      invitations.querySelector("svg path:last-of-type")?.getAttribute("d"),
    ).toBe("M18.5 8v6M15.5 11h6");

    const leave = within(nav).getByRole("link", { name: "Leave" });
    expect(leave.querySelector("svg rect")).toBeTruthy();
  });

  // RED: three different destinations must not share one glyph.
  it("draws three different glyphs", async () => {
    render(await StaffListPage());
    const nav = screen.getByRole("navigation", { name: "Staff shortcuts" });

    const geometry = (name: string) =>
      Array.from(
        within(nav).getByRole("link", { name }).querySelectorAll("svg path"),
      )
        .map((path) => path.getAttribute("d"))
        .join("|");

    expect(geometry("Roster")).not.toBe(geometry("Leave"));
    expect(geometry("Roster")).not.toBe(geometry("Invitations"));
    expect(geometry("Leave")).not.toBe(geometry("Invitations"));
  });

  // RED: Check-in QR is duplicated at the Staff root; the real destination
  // already lives inside the roster page, behind staff.roster.
  it("does not duplicate Check-in QR at the staff root", async () => {
    render(await StaffListPage());
    expect(screen.queryByRole("link", { name: /check-in/i })).toBeNull();
  });

  // CONTROL: the shared create action is still the ONE create affordance,
  // gated by staff.write.
  it("keeps the single shared Add staff action for a writer", async () => {
    render(await StaffListPage());
    const add = screen.queryAllByRole("link", { name: "Add staff" });
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute("href")).toBe("/owner/staff/new");
    expect(add[0]!.hasAttribute("data-owner-create-action")).toBe(true);
  });

  // CONTROL: a read-only caller still gets no create affordance.
  it("offers no create affordance to a read-only caller", async () => {
    ctx.permissions = new Set(["staff.read"]);
    render(await StaffListPage());
    expect(screen.queryAllByRole("link", { name: "Add staff" })).toHaveLength(0);
    expect(document.querySelector("[data-owner-create-action]")).toBeNull();
    // The shortcuts stay reachable for a reader.
    expect(screen.getByRole("navigation", { name: "Staff shortcuts" })).toBeTruthy();
  });

  // CONTROL: the roster page still owns the real Check-in poster link and
  // still requires staff.roster.
  it("keeps Check-in poster on the roster page behind staff.roster", async () => {
    render(await StaffRosterPage({}));
    const poster = screen.queryAllByRole("link", { name: /check-in poster/i });
    expect(poster.length).toBeGreaterThan(0);
    expect(gates).toContain("staff.roster");
  });
});
