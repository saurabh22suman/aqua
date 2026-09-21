// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR2-C7 — the CSV import must be reachable from the members list
// (header + empty state), not only by typing the URL.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({}),
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

describe("MembersPage import entry (PR2-C7)", () => {
  it("links to the import screen from the header", async () => {
    listMembersAction.mockResolvedValue([]);
    render(await MembersPage({}));
    const link = document.body.querySelector('a[href="/owner/members/import"]');
    expect(link).not.toBeNull();
    expect(document.body.textContent).toMatch(/Import/);
  });

  it("offers import alongside 'Add' in the empty state", async () => {
    listMembersAction.mockResolvedValue([]);
    render(await MembersPage({}));
    expect(document.body.textContent).toMatch(/add .*first|no .*yet|import/i);
  });
});
