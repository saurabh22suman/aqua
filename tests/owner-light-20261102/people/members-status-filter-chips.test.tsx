// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the Members directory's
// status filter.
//
// The approved mock shows the status filter as a visible, labelled row of
// chips; the directory still carried a native dropdown, so the filter's
// options were hidden behind a closed control on a phone.
//
// The contract this file pins:
//
//   * the filter is a GROUP of visible chips with the accessible name
//     "Status" — there is no dropdown left in the toolbar;
//   * the chips are the REAL statuses (All, Trial, Active, Paused, Lapsed,
//     Left) and nothing else: no invented "On hold";
//   * the current selection is carried by `aria-pressed`, so the state is
//     announced and not only coloured;
//   * every chip is a 44px target and the row WRAPS, so a 320px phone
//     never scrolls sideways;
//   * choosing a chip filters the list and re-reads it, the latest
//     request still wins, and the state is restored on Back.
//
// No database: the board's only server action is stubbed.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

import { MembersBoard } from "@/components/members-board";
import type { MemberListRow } from "@/lib/services/people";

const ROW: MemberListRow = {
  memberId: "11111111-1111-4111-8111-111111111111",
  personId: "p1",
  fullName: "Asha Rao",
  phone: null,
  memberCode: "M-01",
  status: "active",
  locationId: "loc-1",
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

function renderBoard(members: MemberListRow[] = [ROW]) {
  return render(
    <MembersBoard initialMembers={members} navigationNamespace="tenant-1:user-1" />,
  );
}

function statusGroup() {
  return screen.getByRole("group", { name: "Status" });
}

function chip(name: string) {
  return within(statusGroup()).getByRole("button", { name });
}

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([ROW]);
  window.history.replaceState({}, "", "/owner/members");
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/owner/members");
});

describe("the Members directory's status filter", () => {
  // RED: the filter is a native dropdown, so its options are hidden
  // behind a closed control.
  it("is a visible group of chips, not a dropdown", () => {
    renderBoard();

    const toolbar = screen.getByTestId("list-toolbar");
    expect(toolbar.querySelector("select")).toBeNull();
    expect(statusGroup()).toBeTruthy();
  });

  // RED: the chips must be the REAL statuses and nothing else.
  it("offers every real status and no invented one", () => {
    renderBoard();

    const labels = within(statusGroup())
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());
    expect(labels).toEqual(["All", "Trial", "Active", "Paused", "Lapsed", "Left"]);
    expect(within(statusGroup()).queryByRole("button", { name: /on hold/i })).toBeNull();
  });

  // RED: the current selection is only visible as a colour today.
  it("marks the current selection with aria-pressed", () => {
    renderBoard();

    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Active").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(chip("Paused"));

    expect(chip("Paused").getAttribute("aria-pressed")).toBe("true");
    expect(chip("All").getAttribute("aria-pressed")).toBe("false");
  });

  // RED: a chip is a control, so it needs the 44px target, and the row
  // has to wrap on a narrow phone.
  it("keeps every chip a 44px target on a wrapping row", () => {
    renderBoard();

    const group = statusGroup();
    expect(group.className).toContain("flex-wrap");
    for (const button of within(group).getAllByRole("button")) {
      expect(button.className).toContain("min-h-11");
    }
  });

  // CONTROL: choosing a chip filters the list and re-reads it.
  it("filters the list by the chosen status", async () => {
    renderBoard();

    fireEvent.click(chip("Lapsed"));

    await waitFor(() =>
      expect(listMembersAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "lapsed" }),
      ),
    );
  });

  // CONTROL: the "All" chip is every status again — no status filter at
  // all, not an invented status named "all".
  it("returns to every status from the All chip", async () => {
    renderBoard();

    fireEvent.click(chip("Trial"));
    await waitFor(() =>
      expect(listMembersAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "trial" }),
      ),
    );

    fireEvent.click(chip("All"));
    await waitFor(() =>
      expect(listMembersAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined }),
      ),
    );
  });

  // CONTROL: the latest request still wins — a slow older response must
  // not replace the newer rows.
  it("keeps the latest request when an older one answers late", async () => {
    let finishOld: ((rows: MemberListRow[]) => void) | undefined;
    listMembersAction.mockImplementationOnce(
      () => new Promise((resolve) => { finishOld = resolve; }),
    );
    listMembersAction.mockResolvedValueOnce([
      { ...ROW, memberId: "22222222-2222-4222-8222-222222222222", fullName: "Latest result" },
    ]);
    renderBoard([]);

    fireEvent.click(chip("Trial"));
    fireEvent.click(chip("Paused"));

    await waitFor(() => expect(screen.getByText("Latest result")).toBeTruthy());
    await act(async () => {
      finishOld?.([{ ...ROW, fullName: "Stale result" }]);
    });
    expect(screen.queryByText("Stale result")).toBeNull();
    expect(screen.getByText("Latest result")).toBeTruthy();
  });
});
