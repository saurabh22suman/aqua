// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR2-C7 — the CSV import must be reachable from the members list
// (header + empty state), not only by typing the URL.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

// W1-6 continuation — the page reads the remembered facility cookie;
// jsdom has no request scope, so the cookie always reads as absent.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const listMembersAction = vi.fn();
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/components/members-board", () => ({
  MembersBoard: ({ initialMembers }: { initialMembers: unknown[] }) => (
    <div data-testid="members-board">{initialMembers.length} rows</div>
  ),
}));

import MembersPage from "@/app/(owner)/owner/members/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The directory is a STREAMED section: the page renders its header and
// the board inside a Suspense boundary, so the whole page resolves
// inside an async act.
async function renderPage(searchParams: Record<string, string>) {
  const page = await MembersPage({ searchParams: Promise.resolve(searchParams) });
  await act(async () => {
    render(page);
  });
}

describe("MembersPage import entry (PR2-C7)", () => {
  it("carries the selected facility to Add member", async () => {
    listMembersAction.mockResolvedValue([]);
    await renderPage({ facility: "22222222-2222-4222-8222-222222222222" });
    expect(document.body.querySelector('a[href="/owner/members/new?facility=22222222-2222-4222-8222-222222222222"]')).not.toBeNull();
  });
  it("links to the import screen from the header", async () => {
    listMembersAction.mockResolvedValue([]);
    await renderPage({});
    const link = document.body.querySelector('a[href="/owner/members/import"]');
    expect(link).not.toBeNull();
    expect(document.body.textContent).toMatch(/Import/);
  });

  // The empty DIRECTORY has one owner for its message: the board. The
  // page keeps its heading and its single create action, and the import
  // path stays reachable from the header beside it.
  it("keeps the import path reachable beside the one create action", async () => {
    listMembersAction.mockResolvedValue([]);
    await renderPage({});
    expect(document.body.querySelector('a[href="/owner/members/import"]')).not.toBeNull();
    expect(document.body.querySelector('a[href="/owner/members/new"]')).not.toBeNull();
  });
});
