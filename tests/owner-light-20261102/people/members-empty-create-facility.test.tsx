// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the empty directory's
// create link.
//
// Review finding (HOME lane, REVIEW-PEOPLE.md, F2): the empty
// directory's "Add your first member" CTA opens the add form without the
// selected facility, while the contextual create action carries it, so
// the two add paths can preselect different locations.
//
// This file pins BOTH paths before the correction:
//   * a facility-scoped directory: the CTA must carry that facility, and
//     it must be offered at all (an empty facility is "no member yet",
//     not "no member match" — nothing was searched);
//   * an all-facilities directory: the CTA stays the plain add form.
//
// No database: the board's only server action is stubbed.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
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
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import MembersPage from "@/app/(owner)/owner/members/page";

const LOCATION = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  listMembersAction.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the empty directory's create action", () => {
  // The ONE create action lives in the header and carries the scope; the
  // empty list itself adds none.
  it("keeps the scoped create action in the header, not in the empty list", async () => {
    listMembersAction.mockResolvedValue([]);
    const page = await MembersPage({
      searchParams: Promise.resolve({ facility: LOCATION }),
    });
    await act(async () => {
      render(page);
    });
    const add = screen.queryAllByRole("link", { name: "Add member" });
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute("href")).toBe(`/owner/members/new?facility=${LOCATION}`);
    expect(screen.queryAllByRole("link", { name: /add your first/i })).toHaveLength(0);
    expect(screen.getByTestId("members-list").textContent).toMatch(/No .* yet/i);
  });

  it("opens the plain add form when no facility is selected", async () => {
    listMembersAction.mockResolvedValue([]);
    const page = await MembersPage({ searchParams: Promise.resolve({}) });
    await act(async () => {
      render(page);
    });
    expect(screen.getByRole("link", { name: "Add member" }).getAttribute("href")).toBe(
      "/owner/members/new",
    );
  });
});
