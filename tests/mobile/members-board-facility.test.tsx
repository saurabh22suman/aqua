// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 2026-10-05 audit FE-03 — a facility change is a server navigation.
// The board must adopt the new server rows and reset the local
// search/status filters so the visible controls agree with the list
// instead of leaving the previous facility's rows on screen.

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { MembersBoard } from "@/components/members-board";
import type { MemberListRow } from "@/lib/services/people";
import { listMembersAction } from "@/lib/actions/people";

const FACILITY_A = "11111111-1111-7111-8111-111111111111";
const FACILITY_B = "22222222-2222-7222-8222-222222222222";

function member(id: string, fullName: string, locationName: string): MemberListRow {
  return {
    memberId: id,
    fullName,
    isMinor: false,
    memberCode: `AQUA-${id}`,
    locationName,
    phone: null,
    status: "active",
    createdAt: "2026-09-01T06:00:00.000Z",
    joinedOn: "2026-09-01",
  } as MemberListRow;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MembersBoard facility navigation (FE-03)", () => {
  it("adopts the new facility's rows on rerender without a full page load", () => {
    const { rerender } = render(
      <MembersBoard
        initialMembers={[member("1", "Anita A", "Worli Main")]}
        initialLocationId={FACILITY_A}
      />,
    );
    expect(screen.getByText("Anita A")).toBeTruthy();

    rerender(
      <MembersBoard
        initialMembers={[member("2", "Bhav B", "Bandra Annex")]}
        initialLocationId={FACILITY_B}
      />,
    );

    expect(screen.queryByText("Anita A")).toBeNull();
    expect(screen.getByText("Bhav B")).toBeTruthy();
  });

  it("resets search and status when the facility changes", () => {
    const { rerender } = render(
      <MembersBoard
        initialMembers={[member("1", "Anita A", "Worli Main")]}
        initialLocationId={FACILITY_A}
      />,
    );

    const search = screen.getByLabelText("Search members") as HTMLInputElement;
    const status = screen.getByTestId("members-status-filter") as HTMLSelectElement;
    fireEvent.change(search, { target: { value: "Anita" } });
    fireEvent.change(status, { target: { value: "active" } });
    expect(search.value).toBe("Anita");
    expect(status.value).toBe("active");

    rerender(
      <MembersBoard
        initialMembers={[member("2", "Bhav B", "Bandra Annex")]}
        initialLocationId={FACILITY_B}
      />,
    );

    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (screen.getByTestId("members-status-filter") as HTMLSelectElement).value,
    ).toBe("");
    expect(screen.getByText("Bhav B")).toBeTruthy();
  });

  it("offers retry when search transport fails", async () => {
    vi.mocked(listMembersAction).mockRejectedValueOnce(new Error("Network unavailable"));
    render(<MembersBoard initialMembers={[member("1", "Anita A", "Worli Main")]} initialLocationId={FACILITY_A} />);
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "Anita" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not refresh"));
    vi.mocked(listMembersAction).mockResolvedValueOnce([member("1", "Anita A", "Worli Main")]);
    fireEvent.click(screen.getByRole("button", { name: "Retry member search" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not replace a newer search result with a delayed older response", async () => {
    let finishOld: ((rows: MemberListRow[]) => void) | undefined;
    vi.mocked(listMembersAction).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    vi.mocked(listMembersAction).mockResolvedValueOnce([member("3", "Latest result", "Worli Main")]);
    render(<MembersBoard initialMembers={[]} initialLocationId={FACILITY_A} />);
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "latest" } });
    await waitFor(() => expect(screen.getByText("Latest result")).toBeTruthy());
    await act(async () => { finishOld?.([member("2", "Stale result", "Worli Main")]); });
    expect(screen.queryByText("Stale result")).toBeNull();
    expect(screen.getByText("Latest result")).toBeTruthy();
  });
});
