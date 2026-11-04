// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the Members directory
// create action.
//
// Contract (owner-light-implementation-20261102/CONTRACT.md, bullets 8-9):
//
//   "Members bottom navigation opens directory. Whole member row/card
//    opens THAT profile ... On mobile only, a contextual + FAB opens
//    Add member; desktop header retains labelled Add. No duplicate
//    mobile header Add. Import stays accessible, not a conflicting
//    second primary."
//
//   "Shared create interface (foundation owns):
//    components/owner-ui/owner-create-action.tsx exports
//    OwnerCreateAction({href,label,testId?,className?}). It renders one
//    accessible link ... Do not duplicate local FAB implementations."
//
// This file is rendered evidence, not a source-string scan: the owner
// Members PAGE is rendered with the real MembersBoard and the real
// shared page primitives, and the accessible names and destinations of
// the rendered links are asserted.
//
// No database: every server action the page reaches is replaced by a
// local stub, so the module graph never opens a connection.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

const requireOwner = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: (...args: unknown[]) => requireOwner(...args),
  requirePagePermission: (ctx: unknown) => ctx,
}));

// The owner layout persists the facility choice in a cookie; jsdom has no
// request scope, so the cookie always reads as absent and the page falls
// back to the `?facility=` parameter.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import MembersPage from "@/app/(owner)/owner/members/page";
import type { MemberListRow } from "@/lib/services/people";

const FACILITY = "22222222-2222-4222-8222-222222222222";

const ROW: MemberListRow = {
  memberId: "11111111-1111-4111-8111-111111111111",
  personId: "p1",
  fullName: "Test One",
  phone: null,
  memberCode: "M-01",
  status: "active",
  locationId: "loc-1",
  locationName: "Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

async function renderMembersPage(searchParams: Record<string, string> = {}) {
  listMembersAction.mockResolvedValue([ROW]);
  const page = await MembersPage({ searchParams: Promise.resolve(searchParams) });
  // The directory streams behind its own boundary now; an async section
  // resolves only inside an async act.
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(page);
  });
  return view;
}

beforeEach(() => {
  listMembersAction.mockReset();
  requireOwner.mockReset();
  requireOwner.mockResolvedValue({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write"]),
    features: new Set(["members"]),
  });
});

afterEach(() => {
  cleanup();
});

describe("owner Members directory create action", () => {
  // INTENDED RED — the directory has no contextual "Add member" action
  // yet: the only create affordance is the generic header link labelled
  // "Add", which is neither the agreed accessible name nor the agreed
  // shared create interface.
  it("offers a single Add member action that opens the real add form", async () => {
    await renderMembersPage();
    const addLinks = screen.queryAllByRole("link", { name: "Add member" });
    expect(addLinks).toHaveLength(1);
    expect(addLinks[0]?.getAttribute("href")).toBe("/owner/members/new");
  });

  // INTENDED RED — the generic header "Add" is a second, differently
  // named primary create action. The contract keeps exactly one create
  // affordance per viewport and forbids a duplicate mobile header Add.
  it("does not repeat a generic Add action beside Import", async () => {
    await renderMembersPage();
    expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
  });

  // NEGATIVE CONTROL — Import stays reachable as a secondary action and
  // must keep working after the create action is replaced.
  it("keeps Import reachable as a secondary action", async () => {
    await renderMembersPage();
    const importLink = screen.getByRole("link", { name: "Import" });
    expect(importLink.getAttribute("href")).toBe("/owner/members/import");
  });

  // NEGATIVE CONTROL — the selected facility must still travel into the
  // add form, whichever control carries the create action.
  it("carries the selected facility into the add form", async () => {
    await renderMembersPage({ facility: FACILITY });
    expect(
      document.body.querySelector(`a[href="/owner/members/new?facility=${FACILITY}"]`),
    ).not.toBeNull();
  });

  // NEGATIVE CONTROL — an empty directory keeps its own in-content call
  // to action, worded differently from the contextual create action, so
  // the create action is never duplicated on an empty list.
  // The header owns the ONE create action; the empty list keeps its honest
  // explanation and adds no second "add the first member" action.
  it("keeps the empty directory's explanation without a second create action", async () => {
    listMembersAction.mockResolvedValue([]);
    const page = await MembersPage({ searchParams: Promise.resolve({}) });
    await act(async () => {
      render(page);
    });
    expect(screen.queryAllByRole("link", { name: /add your first/i })).toHaveLength(0);
    expect(screen.getByTestId("members-list").textContent).toMatch(/No .* yet/i);
  });

  // NEGATIVE CONTROL — a read-only owner sees no create action at all.
  // The permission gate stays on the server, before any create control
  // is rendered.
  it("shows no create action to an owner who cannot write members", async () => {
    requireOwner.mockResolvedValueOnce({
      tenantId: "tenant-1",
      userId: "user-1",
      roleKey: "owner",
      permissions: new Set(["members.read"]),
      features: new Set(["members"]),
    });
    await renderMembersPage();
    expect(screen.queryAllByRole("link", { name: "Add member" })).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Import" })).toBeNull();
  });
});
