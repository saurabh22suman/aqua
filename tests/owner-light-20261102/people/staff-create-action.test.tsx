// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — Staff creation uses the
// shared create action.
//
// Human steering: the Staff header's button cluster is ugly and there is
// no "＋ Add staff" — the create affordance must be the SAME shared one as
// Members: the round 56px floating action above the phone navigation and
// the inline labelled action on a desktop, both from
// `components/owner-ui/owner-create-action.tsx`.
//
// The page gate is unchanged: `staff.read` renders the page, and only a
// caller with `staff.write` may see a create affordance. The redundant
// generic subtitle goes (minimal-text direction).
//
// INTENDED RED (this file): the page renders its own plain header button
// with no shared marker or plus glyph, shows it to a read-only caller, and
// still prints the generic subtitle.
//
// No database: the page's actions are stubbed.

import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: ctx.permissions,
    features: new Set<string>(),
    roleKey: ctx.roleKey,
  }),
  requirePagePermission: (value: unknown) => value,
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
}));

vi.mock("@/lib/actions/tenant-owner-reset", () => ({
  listOwnerMembershipsAction: async () => [],
}));

import StaffListPage from "@/app/(owner)/owner/staff/page";

beforeEach(() => {
  ctx.permissions = new Set(["staff.read", "staff.write", "staff.roster"]);
  ctx.roleKey = "owner";
});

afterEach(cleanup);

describe("Staff creation uses the shared create action", () => {
  // RED: the header renders its own plain "Add staff record" button — no
  // shared marker, no plus glyph, not the agreed "Add staff" name.
  it("offers the shared Add staff action to a writer", async () => {
    render(await StaffListPage());

    const add = screen.queryAllByRole("link", { name: "Add staff" });
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute("href")).toBe("/owner/staff/new");
    expect(add[0]!.hasAttribute("data-owner-create-action")).toBe(true);

    // The shared action's plus glyph, not a bare text button.
    const plus = add[0]!.querySelector("svg path");
    expect(plus?.getAttribute("d")).toBe("M12 5v14M5 12h14");
  });

  // RED: a read-only caller must not be offered a create affordance.
  it("offers no create action to a staff.read-only caller", async () => {
    ctx.permissions = new Set(["staff.read"]);
    render(await StaffListPage());

    expect(screen.queryAllByRole("link", { name: /add staff/i })).toHaveLength(0);
    expect(document.querySelector("[data-owner-create-action]")).toBeNull();
    // The directory itself is still readable.
    expect(screen.getByTestId("staff-list")).toBeTruthy();
    // The board renders the desktop table and the phone cards.
    expect(screen.getAllByText("Aanya Rao").length).toBeGreaterThan(0);
  });

  // RED: the generic subtitle repeated what the page title says.
  it("carries no generic subtitle", async () => {
    render(await StaffListPage());
    expect(screen.queryByText(/The people who run the academy/i)).toBeNull();
  });

  // CONTROL: every existing staff task and destination is untouched.
  it("keeps the existing staff tasks and access recovery", async () => {
    render(await StaffListPage());
    // Check-in QR is no longer duplicated here; the roster page owns the
    // real "Check-in poster" destination behind staff.roster.
    for (const name of ["Roster", "Invitations", "Leave"]) {
      expect(screen.getByRole("link", { name }), name).toBeTruthy();
    }
    expect(screen.getByRole("heading", { level: 1, name: "Staff" })).toBeTruthy();
    // Recovery is owner-only and is absent when there are no owner rows.
    expect(screen.queryByText("Owner access recovery")).toBeNull();
  });

  // CONTROL: the create affordance is never offered to another role.
  it("offers creation to staff.write holders, including delegated admins", async () => {
    ctx.permissions = new Set(["staff.read", "staff.write"]);
    ctx.roleKey = "admin";
    render(await StaffListPage());
    const add = screen.queryAllByRole("link", { name: "Add staff" });
    expect(add).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Owner access recovery");
  });
});
