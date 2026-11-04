// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the invitations
// destination's title.
//
// The Staff page's shortcut says "Invitations" and Settings says
// "Invitations", but the destination opened a page titled "Staff access"
// with a second visible heading that said "Invitations" again. The
// owner had to learn two names for one place.
//
// The contract this file pins:
//
//   * the destination page is titled "Invitations" — the same word the
//     shortcut and the settings entry use;
//   * the SUBTITLE keeps what the page really does: the pending and
//     active logins it lists, and the consequence of revoking an active
//     row;
//   * the page carries ONE visible heading, so the title is not
//     repeated inside the card.
//
// No database: every action the page reaches is stubbed.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["staff.invite", "staff.read"]),
    features: new Set(["staff"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("@/lib/actions/staff-invitations", () => ({
  listInvitationsAction: vi.fn(async () => []),
  createInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  reactivateInvitationAction: vi.fn(),
}));

import StaffInvitationsPage from "@/app/(owner)/owner/staff/invitations/page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("the invitations destination", () => {
  // RED: the page is titled "Staff access", not the word the shortcut
  // and the settings entry use.
  it("is titled Invitations", async () => {
    render(await StaffInvitationsPage());

    expect(screen.getByRole("heading", { level: 1 }).textContent?.trim()).toBe(
      "Invitations",
    );
  });

  // CONTROL: the subtitle keeps what the page does — the pending and
  // active logins, and the consequence of a revocation.
  it("keeps the pending and active access and the revocation consequence in the subtitle", async () => {
    render(await StaffInvitationsPage());

    const header = screen.getByRole("heading", { level: 1 }).parentElement;
    const subtitle = header?.querySelector("p");
    expect(subtitle?.textContent ?? "").toMatch(/pending and active logins/i);
    expect(subtitle?.textContent ?? "").toMatch(
      /revoking an active row removes that person's access/i,
    );
  });

  // CONTROL: one visible heading — the title is not repeated inside the
  // card.
  it("carries one visible heading", async () => {
    render(await StaffInvitationsPage());

    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
  });

  // CONTROL: the create action and the honest delivery notice stay.
  it("keeps the invite action and the delivery notice", async () => {
    render(await StaffInvitationsPage());

    const invite = screen.getByRole("link", { name: "Invite staff" });
    expect(invite.getAttribute("href")).toBe("/owner/staff/invitations/new");
    expect(document.body.textContent).toMatch(
      /creating or sharing a login link is not proof it was delivered/i,
    );
  });
});
