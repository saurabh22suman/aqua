// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the Members directory's
// no-match state.
//
// The completed owner review found the no-match state was a dead end: it
// said "No member match." and offered nothing, so one stale filter (a
// name that no longer exists, a status nobody holds) left the owner with
// no way back but a page reload.
//
// The contract this file pins:
//
//   * the no-match state carries a SECONDARY "Clear filters" action —
//     the approved preview's `btn btn-secondary` beside the sentence;
//   * clearing drops the SEARCH TEXT and the STATUS FILTER, and the
//     persisted list state, so Back never restores the filters the
//     owner just dismissed;
//   * the FACILITY SCOPE is untouched: clearing a filter never widens
//     the directory beyond the selected facility;
//   * the rows come back from an AUTHORITATIVE read, and a failed read
//     stays a failure — it is never shown as an empty result;
//   * an academy that simply holds nobody is NOT a no-match state: it
//     keeps its honest "no member yet" copy and adds no second create
//     action.
//
// No database: the board's only server action is stubbed.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

import { MembersBoard } from "@/components/members-board";
import {
  armMembersReturnIntent,
  peekMembersReturnIntent,
  recordMembersReturnIntent,
} from "@/components/members-list-navigation";
import type { MemberListRow } from "@/lib/services/people";

const KEY = "tenant-1:user-1";
const LOCATION = "22222222-2222-4222-8222-222222222222";

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  lapsed: "Lapsed",
  left: "Left",
};

const ROW: MemberListRow = {
  memberId: "11111111-1111-4111-8111-111111111111",
  personId: "p1",
  fullName: "Asha Rao",
  phone: null,
  memberCode: "M-01",
  status: "active",
  locationId: LOCATION,
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

function renderBoard(members: MemberListRow[] = [ROW]) {
  return render(
    <MembersBoard
      initialMembers={members}
      initialLocationId={LOCATION}
      navigationNamespace={KEY}
    />,
  );
}

/** The list read: the real rows only when nothing is filtered. */
function readMembers() {
  listMembersAction.mockImplementation(
    async (input: { search?: string; status?: string }) => {
      if (input?.search || input?.status) return [];
      return [ROW];
    },
  );
}

async function typeSearch(value: string) {
  fireEvent.change(screen.getByTestId("members-search"), {
    target: { value },
  });
  await waitFor(() =>
    expect(listMembersAction).toHaveBeenCalledWith(
      expect.objectContaining({ search: value }),
    ),
  );
}

/**
 * The status filter control is a select today and a chip group after the
 * status-filter change; this helper drives whichever is present, so the
 * file states the BEHAVIOUR and not the control's shape.
 */
async function applyStatus(value: string) {
  const chip = screen.queryByRole("button", { name: STATUS_LABEL[value] });
  if (chip) {
    fireEvent.click(chip);
  } else {
    fireEvent.change(screen.getByTestId("members-status-filter"), {
      target: { value },
    });
  }
  await waitFor(() =>
    expect(listMembersAction).toHaveBeenCalledWith(
      expect.objectContaining({ status: value }),
    ),
  );
}

beforeEach(() => {
  listMembersAction.mockReset();
  readMembers();
  window.history.replaceState({}, "", "/owner/members");
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/owner/members");
});

describe("the Members directory's no-match state", () => {
  // RED: the no-match state is a dead end — it names the problem and
  // offers no way out.
  it("offers a Clear filters action", async () => {
    renderBoard([]);
    await typeSearch("nobody");

    await waitFor(() =>
      expect(screen.getByTestId("members-list").textContent).toMatch(/No .* match/i),
    );
    const clear = screen.queryByRole("button", { name: "Clear filters" });
    expect(clear, "the no-match state has no way out").toBeTruthy();
  });

  // RED: the action must actually clear the search AND the status, and
  // re-read the list with NO query at all.
  it("clears the search and the status and re-reads the list unfiltered", async () => {
    renderBoard([]);
    await typeSearch("nobody");
    await applyStatus("lapsed");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() =>
      expect(listMembersAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: undefined, status: undefined }),
      ),
    );
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("");
  });

  // CONTROL: the facility scope is untouched — clearing a filter never
  // widens the directory beyond the selected facility.
  it("keeps the selected facility scope", async () => {
    renderBoard([]);
    await typeSearch("nobody");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() =>
      expect(listMembersAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ locationId: LOCATION }),
      ),
    );
  });

  // CONTROL: the real rows come back after the clear.
  it("shows the real rows again after the clear", async () => {
    renderBoard([]);
    await typeSearch("nobody");
    await waitFor(() =>
      expect(screen.getByTestId("members-list").textContent).toMatch(/No .* match/i),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(screen.getAllByTestId("member-row")).toHaveLength(1));
    expect(screen.getByTestId("member-row-name").textContent).toContain("Asha Rao");
  });

  // RED: the persisted list state still holds the dismissed filters, so
  // Back would restore what the owner just cleared.
  it("drops the persisted list state", async () => {
    renderBoard([]);
    await typeSearch("nobody");
    await applyStatus("lapsed");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      const saved = (
        window.history.state as { ownerMembersList?: Record<string, unknown> } | null
      )?.ownerMembersList;
      expect(saved).toMatchObject({ search: "", status: "", locationId: LOCATION });
    });
  });

  // RED: an armed return intent would restore the dismissed filters when
  // the owner comes back from a profile.
  it("drops the armed return intent", async () => {
    renderBoard([]);
    await typeSearch("nobody");
    recordMembersReturnIntent({
      namespace: KEY,
      locationId: LOCATION,
      search: "nobody",
      status: "lapsed",
      scrollY: 0,
    });
    armMembersReturnIntent();
    expect(peekMembersReturnIntent(KEY, LOCATION)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(peekMembersReturnIntent(KEY, LOCATION)).toBeNull();
  });

  // RED: a failed read is shown as a failure — never as "no member
  // match", which would claim the filter answered the question.
  it("keeps a failed read distinct from an empty result", async () => {
    renderBoard([]);
    await typeSearch("nobody");
    await waitFor(() =>
      expect(screen.getByTestId("members-list").textContent).toMatch(/No .* match/i),
    );

    listMembersAction.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/could not refresh/i),
    );
    expect(screen.getByTestId("members-list").textContent).not.toMatch(/No .* match/i);
  });

  // CONTROL: an academy that holds nobody is not a no-match state — it
  // keeps its own honest copy and adds no second create action.
  it("keeps the true-empty state free of a clear action and a second create", async () => {
    renderBoard([]);

    expect(screen.getByTestId("members-list").textContent).toMatch(/No .* yet/i);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(
      within(screen.getByTestId("members-list")).queryAllByRole("link", { name: /add/i }),
    ).toHaveLength(0);
  });
});
