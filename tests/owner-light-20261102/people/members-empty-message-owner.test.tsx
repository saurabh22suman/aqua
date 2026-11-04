// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the empty directory's
// message has ONE owner.
//
// The members PAGE rendered its own paragraph — "No members yet — add the
// first one, or import your existing register." — and the BOARD rendered
// its own empty state — "No members yet. Add your first member to start
// building the roster." The owner read the same news twice, in two
// different sentences, in two different voices, on one screen.
//
// The contract this file pins:
//
//   * the BOARD owns the empty message: exactly ONE is rendered;
//   * the page keeps its heading and its single create action (the
//     header's import action stays too — the import path is not lost);
//   * the three empty states stay distinct: a failed read, a filter that
//     matched nothing, and a facility that holds nobody.
//
// No database: the page's actions are stubbed.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());
const ctx = vi.hoisted(() => ({
  permissions: new Set<string>(["members.read", "members.write"]),
}));

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
    permissions: ctx.permissions,
    features: new Set(["members"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (_ctx: unknown, permission: string) =>
    ctx.permissions.has(permission),
  hasFeature: () => false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import MembersPage from "@/app/(owner)/owner/members/page";

const LOCATION = "22222222-2222-4222-8222-222222222222";

async function renderPage() {
  const page = await MembersPage({
    searchParams: Promise.resolve({ facility: LOCATION }),
  });
  // The directory is a streamed section: it resolves inside an async
  // act, so the whole page (header and board) is rendered there.
  await act(async () => {
    render(page);
  });
}

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([]);
  ctx.permissions = new Set(["members.read", "members.write"]);
});

afterEach(cleanup);

describe("the empty members directory", () => {
  // RED: the page and the board both say the directory is empty.
  it("renders the empty message once, from the board", async () => {
    await renderPage();

    const emptyMessages = Array.from(document.querySelectorAll("p")).filter((p) =>
      /No .* yet/i.test(p.textContent ?? ""),
    );
    expect(emptyMessages, "the empty message has two owners").toHaveLength(1);

    const board = screen.getByTestId("empty-state");
    expect(board.textContent).toMatch(/No members yet/i);
    expect(board.textContent).toMatch(/Add your first member/i);
    // The page's own helper sentence is gone.
    expect(screen.queryByText(/import your existing register/i)).toBeNull();
  });

  // CONTROL: the page keeps its heading and its single create action,
  // and the import path stays reachable from the header.
  it("keeps the heading, the create action and the import action", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Members");
    const add = screen.getAllByRole("link", { name: "Add member" });
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute("href")).toBe(`/owner/members/new?facility=${LOCATION}`);
    expect(screen.getByTestId("members-import-link").getAttribute("href")).toBe(
      "/owner/members/import",
    );
  });

  // CONTROL: the three empty states stay distinct — a facility that
  // holds nobody is "no member yet", not "no match".
  it("keeps the true-empty state distinct from a no-match result", async () => {
    await renderPage();

    expect(screen.getByTestId("empty-state").textContent).toMatch(/No members yet/i);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  // RED: the board now owns the empty message, so it must be true for
  // the role reading it. Dot's empty-state rule is "No members yet →
  // 'Add member', WHERE PERMITTED" (UI-UX.txt §6): a caller who may
  // only READ is not told to add one.
  it("does not tell a reader to add a member", async () => {
    ctx.permissions = new Set(["members.read"]);
    await renderPage();

    const empty = screen.getByTestId("empty-state");
    expect(empty.textContent).not.toMatch(/add your first member/i);
    expect(empty.textContent).toMatch(/not add/i);
  });
});
