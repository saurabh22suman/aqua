// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — the shared list/filter toolbar.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
//   1. The members list rendered its search field and its status
//      filter in two separate stacked blocks. They had no shared
//      container, so their control bottoms could never align and the
//      filter had no visible label — only an aria-label.
//   2. A directory row read name → metadata → phone → status, so on a
//      phone the lifecycle state sat below the metadata instead of
//      beside the identity.
//
// The approved direction (docs/design/owner-redesign-20261027/contract.md,
// "A toolbar aligns control bottoms…") and the approved preview's member
// directory ("Mobile keeps names and status above metadata") are the
// requirement. Geometry (bottom-edge alignment, overflow) is proved in the
// browser, not here; these assertions are the DOM/association contract the
// browser check depends on.

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { MembersBoard } from "@/components/members-board";
import { listMembersAction } from "@/lib/actions/people";
import type { MemberListRow } from "@/lib/services/people";

function member(id: string, fullName: string): MemberListRow {
  return {
    memberId: id,
    fullName,
    isMinor: false,
    memberCode: `AWS-${id}`,
    locationName: "Worli Main",
    phone: "+919812340010",
    status: "active",
    createdAt: "2026-09-01T06:00:00.000Z",
    joinedOn: "2026-09-01",
  } as MemberListRow;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("owner people list toolbar (C2)", () => {
  it("keeps the search field and the status filter inside one shared toolbar", () => {
    render(<MembersBoard initialMembers={[member("1", "Aadhya Sharma")]} />);

    const toolbar = screen.getByTestId("list-toolbar");
    const search = screen.getByLabelText("Search members");
    const status = screen.getByTestId("members-status-filter");

    expect(toolbar.contains(search)).toBe(true);
    expect(toolbar.contains(status)).toBe(true);
  });

  it("gives the status filter a visible label instead of an aria-label alone", () => {
    render(<MembersBoard initialMembers={[member("1", "Aadhya Sharma")]} />);

    const status = screen.getByTestId("members-status-filter") as HTMLSelectElement;
    const label = document.querySelector(`label[for="${status.id}"]`);

    expect(label, "the filter needs a visible label").not.toBeNull();
    expect(label?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("reads a directory row as identity, then status, then metadata", () => {
    render(<MembersBoard initialMembers={[member("1", "Aadhya Sharma")]} />);

    const row = screen.getByTestId("members-list").querySelector("a");
    const text = row?.textContent ?? "";

    expect(text.indexOf("Aadhya Sharma")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Active")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("AWS-1")).toBeGreaterThanOrEqual(0);

    // Identity first, lifecycle state next, supporting metadata last.
    expect(text.indexOf("Aadhya Sharma")).toBeLessThan(text.indexOf("Active"));
    expect(text.indexOf("Active")).toBeLessThan(text.indexOf("AWS-1"));
  });

  it("keeps the search, filter and retry journeys working", async () => {
    vi.mocked(listMembersAction).mockRejectedValueOnce(new Error("Network unavailable"));
    render(<MembersBoard initialMembers={[member("1", "Aadhya Sharma")]} />);

    fireEvent.change(screen.getByLabelText("Search members"), {
      target: { value: "Aadhya" },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Could not refresh"),
    );

    vi.mocked(listMembersAction).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry member search" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    fireEvent.change(screen.getByTestId("members-status-filter"), {
      target: { value: "paused" },
    });
    await waitFor(() =>
      expect(vi.mocked(listMembersAction).mock.calls.at(-1)?.[0]).toMatchObject({
        status: "paused",
      }),
    );
  });
});
