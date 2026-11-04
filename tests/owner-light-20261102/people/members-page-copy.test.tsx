// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the Members page's copy
// and the configured member term.
//
// Actual Chrome r4 RED (combined integration, 390px, before these source
// changes): the page carried a generic purpose line — "Find a person and
// continue their work." — and a second VISIBLE heading, "Member
// directory", both repeating what the page title and the labelled search
// already say.
//
// The accepted mock's Members view is ONE page heading, the fields and the
// rows. This file pins that: the redundant visible texts go, while the
// list's accessible name, the result count, the field labels and the
// configured tenant term all stay.
//
// No database: every server action the page reaches is stubbed.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());
const getTerminologyAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: (...args: unknown[]) => getTerminologyAction(...args),
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

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import MembersPage from "@/app/(owner)/owner/members/page";
import type { MemberListRow } from "@/lib/services/people";

const ROW: MemberListRow = {
  memberId: "11111111-1111-4111-8111-111111111111",
  personId: "p1",
  fullName: "Chandrashekhar Balasubramanian Iyer",
  phone: "+919812340099",
  memberCode: "M-01",
  status: "active",
  locationId: "loc-1",
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

const DEFAULT_TERMINOLOGY = { locale: "en", overrides: {} };
const SWIMMER_TERMINOLOGY = {
  locale: "en",
  overrides: { member: { en: { one: "swimmer", other: "swimmers" } } },
};

async function renderMembersPage() {
  listMembersAction.mockResolvedValue([ROW]);
  const page = await MembersPage({ searchParams: Promise.resolve({}) });
  // The directory is its own streamed section now: an async section resolves
  // only inside an async act, so render there and return the resolved view.
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(page);
  });
  return view;
}

beforeEach(() => {
  listMembersAction.mockReset();
  getTerminologyAction.mockReset();
  getTerminologyAction.mockResolvedValue(DEFAULT_TERMINOLOGY);
});

afterEach(() => {
  cleanup();
});

describe("the Members page copy", () => {
  // RED: the generic purpose line repeated what the page title and the
  // labelled search already say.
  it("carries no generic purpose paragraph", async () => {
    await renderMembersPage();
    expect(
      screen.queryByText("Find a person and continue their work."),
    ).toBeNull();
  });

  // RED: the visible "Member directory" heading repeated the page title.
  it("has no second visible directory heading", async () => {
    await renderMembersPage();
    expect(
      screen.queryAllByRole("heading", { name: /member directory/i }),
    ).toHaveLength(0);
  });

  // RED: the list must still carry an accessible name — the heading is
  // gone, the NAME is not.
  it("keeps the list's accessible name", async () => {
    await renderMembersPage();
    expect(
      screen.queryAllByRole("list", { name: /member directory/i }),
    ).toHaveLength(1);
  });

  // CONTROL: the useful parts stay — the count, the field labels, the
  // contextual create action and the row navigation.
  it("keeps the count, the labels and the create action", async () => {
    await renderMembersPage();
    expect(screen.getByText("1 record")).toBeTruthy();
    expect(screen.getByLabelText("Search members")).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add member" })).toBeTruthy();
    expect(screen.getByTestId("member-row").getAttribute("href")).toBe(
      `/owner/members/${ROW.memberId}?facility=all`,
    );
  });
});

describe("the configured member term", () => {
  // CONTROL: the tenant's own word labels the contextual create action.
  it("labels the contextual create action with the tenant's word", async () => {
    getTerminologyAction.mockResolvedValue(SWIMMER_TERMINOLOGY);
    await renderMembersPage();
    const action = screen.getByRole("link", { name: "Add swimmer" });
    expect(action.getAttribute("href")).toBe("/owner/members/new");
  });

  // RED: the list's accessible name must carry the tenant's word too.
  it("labels the list with the tenant's word", async () => {
    getTerminologyAction.mockResolvedValue(SWIMMER_TERMINOLOGY);
    await renderMembersPage();
    expect(
      screen.queryAllByRole("list", { name: /swimmer directory/i }),
    ).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Swimmers" })).toBeTruthy();
  });
});
