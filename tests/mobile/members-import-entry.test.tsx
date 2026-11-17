// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams(),
}));

import MembersPage from "@/app/(owner)/owner/members/page";

async function renderDirectory() {
  const page = await MembersPage({});
  const child = page.props.children as ReactElement<Record<string, unknown>, (props: Record<string, unknown>) => Promise<ReactElement>>;
  render(await child.type(child.props));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MembersPage import entry (PR2-C7)", () => {
  it("links to the import screen from the header", async () => {
    listMembersAction.mockResolvedValue([]);
    await renderDirectory();
    const link = await screen.findByRole("link", { name: /import/i });
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/owner/members/import");
  });

  it("offers import alongside 'Add' in the empty state", async () => {
    listMembersAction.mockResolvedValue([]);
    await renderDirectory();
    expect(await screen.findByText(/no members yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /import/i }).getAttribute("href")).toBe("/owner/members/import");
  });
});
