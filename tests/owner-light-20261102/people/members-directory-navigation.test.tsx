// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — Members directory
// navigation and list-state retention.
//
// Contract (owner-light-implementation-20261102/CONTRACT.md, bullet 8):
//
//   "Whole member row/card opens THAT profile, accessible label/focus,
//    no nested-interactive hijacking ... Back retains query/status/facility
//    and scroll without resetting unsaved work."
//
// The existing components/members-list-navigation.ts already carries the
// filter/scroll state on the current history entry and restores it on a
// real Back. This file is the RENDERED proof that the behaviour is real
// and is preserved by the redesign, so the implementation phase verifies
// it instead of rewriting it blindly.
//
// No database: the only server action the board reaches is stubbed.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

import { MembersBoard } from "@/components/members-board";
import type { MemberListRow } from "@/lib/services/people";

const KEY = "tenant-1:user-1";
const LOCATION = "loc-1";

const ROW: MemberListRow = {
  memberId: "11111111-1111-4111-8111-111111111111",
  personId: "p1",
  fullName: "Test One",
  phone: null,
  memberCode: "M-01",
  status: "active",
  locationId: LOCATION,
  locationName: "Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

const OTHER_ROW: MemberListRow = {
  ...ROW,
  memberId: "33333333-3333-4333-8333-333333333333",
  personId: "p2",
  fullName: "Test Two",
  memberCode: "M-02",
  status: "paused",
};

let frames: FrameRequestCallback[] = [];

async function flushFrames() {
  for (let i = 0; i < 8 && frames.length > 0; i += 1) {
    const batch = frames;
    frames = [];
    await act(async () => {
      batch.forEach((frame) => frame(0));
      await Promise.resolve();
    });
  }
}

function renderBoard(members: MemberListRow[] = [ROW, OTHER_ROW]) {
  return render(
    <MembersBoard
      initialMembers={members}
      initialLocationId={LOCATION}
      navigationNamespace={KEY}
    />,
  );
}

// The status filter is a group of chips; the pressed chip is the current
// selection.
function statusChip(name: string) {
  return within(screen.getByRole("group", { name: "Status" })).getByRole("button", {
    name,
  });
}

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([ROW, OTHER_ROW]);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  window.history.replaceState({}, "", "/owner/members");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/owner/members");
});

describe("owner Members directory navigation", () => {
  // NEGATIVE CONTROL — the whole row is one link to THAT member, and it
  // holds no nested control that would hijack the tap.
  it("opens that member's profile from the whole row", () => {
    renderBoard();
    const rows = screen.getAllByTestId("member-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("href")).toBe(
      `/owner/members/${ROW.memberId}?facility=${LOCATION}`,
    );
    expect(rows[1]?.getAttribute("href")).toBe(
      `/owner/members/${OTHER_ROW.memberId}?facility=${LOCATION}`,
    );
    expect(rows[0]?.querySelectorAll("a,button,input,select").length).toBe(0);
    expect(rows[0]?.textContent).toContain("Test One");
  });

  // NEGATIVE CONTROL — the directory reads inside the selected facility.
  it("reads the list inside the selected facility", async () => {
    renderBoard();
    fireEvent.change(screen.getByTestId("members-search"), {
      target: { value: "e" },
    });
    await waitFor(() => expect(listMembersAction).toHaveBeenCalled());
    expect(listMembersAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: LOCATION }),
    );
  });

  // NEGATIVE CONTROL — the search text and the status filter survive the
  // trip into a profile and back, together with the scroll position.
  it("restores the search, the status filter and the scroll position when the owner comes back", async () => {
    const first = renderBoard();

    fireEvent.change(screen.getByTestId("members-search"), {
      target: { value: "e" },
    });
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(1));
    fireEvent.click(statusChip("Active"));
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(2));

    // The owner opens a profile from a scrolled list.
    (window as unknown as { scrollY: number }).scrollY = 480;
    fireEvent.click(screen.getAllByTestId("member-row")[0]!);

    const saved = (
      window.history.state as { ownerMembersList?: Record<string, unknown> } | null
    )?.ownerMembersList;
    expect(saved).toMatchObject({
      namespace: KEY,
      locationId: LOCATION,
      search: "e",
      status: "active",
      scrollY: 480,
    });

    // The profile replaces the list; Back brings the list back.
    first.unmount();
    listMembersAction.mockClear();
    renderBoard();
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() =>
      expect(listMembersAction).toHaveBeenCalledWith(
        expect.objectContaining({ search: "e", status: "active", locationId: LOCATION }),
      ),
    );
    expect(
      (screen.getByTestId("members-search") as HTMLInputElement).value,
    ).toBe("e");
    expect(statusChip("Active").getAttribute("aria-pressed")).toBe("true");

    await flushFrames();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 480);
  });

  // NEGATIVE CONTROL — a list state saved under another account or
  // another facility is never adopted by this directory.
  it("ignores a list state saved for another account or facility", async () => {
    window.history.replaceState(
      {
        ownerMembersList: {
          namespace: "tenant-9:user-9",
          locationId: LOCATION,
          search: "secret",
          status: "lapsed",
          scrollY: 120,
        },
      },
      "",
      "/owner/members",
    );
    renderBoard();
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(listMembersAction).not.toHaveBeenCalled();
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("");
  });
});
