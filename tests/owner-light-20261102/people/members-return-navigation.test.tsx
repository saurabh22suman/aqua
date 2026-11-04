// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the in-app return's
// NAVIGATION, not just its state.
//
// Actual Chrome r2 journey RED (combined integration): "In-app Members
// return keeps search" — ok: false.
//
// Root cause (Next 15.5, next/dist/client/app-dir/link.js): the <a>'s own
// React handler runs FIRST and, inside `linkClicked`, it calls
// `e.preventDefault()` (line 71) and then dispatches the navigation. A
// wrapper handler that runs LATER on the bubble therefore sees
// `defaultPrevented === true` and gives up, and any navigation it issues
// is a SECOND one. The return intent was never armed, so the directory
// came back fresh.
//
// This file reproduces that ordering with a Next-like child (the same
// contract: preventDefault, then navigate) and asserts exactly ONE
// navigation, the intent armed BEFORE it, the facility scope kept, and
// the single-use intent surviving a cancelled effect.
//
// No database: the board's only server action is stubbed.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back: vi.fn() }),
}));

import { MembersBoard } from "@/components/members-board";
import { MembersReturnLink } from "@/components/members-return-link";
import { clearMembersReturnIntent } from "@/components/members-list-navigation";
import type { MemberListRow } from "@/lib/services/people";

const KEY = "tenant-1:user-1";
const LOCATION = "22222222-2222-4222-8222-222222222222";

const ROW: MemberListRow = {
  memberId: "11111111-1111-4111-8111-111111111111",
  personId: "p1",
  fullName: "Chandrashekhar Balasubramanian Iyer",
  phone: "+919812340099",
  memberCode: "M-01",
  status: "active",
  locationId: LOCATION,
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

let frames: FrameRequestCallback[] = [];
let childNavigations: string[] = [];

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

/**
 * A child link with next/link's contract: it ignores a modified click,
 * and otherwise it prevents the browser's navigation and navigates.
 * next/link does this inside the <a>'s own handler, which runs BEFORE
 * any handler on an ancestor.
 */
function NextLikeLink({
  href,
  onNavigate,
}: {
  href: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.defaultPrevented) return;
        event.preventDefault();
        onNavigate(href);
      }}
    >
      Members
    </a>
  );
}

function renderBoard(strict = false) {
  const board = (
    <MembersBoard
      initialMembers={[ROW]}
      initialLocationId={LOCATION}
      navigationNamespace={KEY}
    />
  );
  return render(strict ? <StrictMode>{board}</StrictMode> : board);
}

/** The list, then a profile, then the profile's own Members link. */
async function openProfileAndReturn(strict = false) {
  const list = renderBoard(strict);
  fireEvent.change(screen.getByTestId("members-search"), {
    target: { value: "e" },
  });
  await waitFor(() => expect(listMembersAction).toHaveBeenCalled());
  fireEvent.click(screen.getAllByTestId("member-row")[0]!);
  list.unmount();

  const profile = render(
    <MembersReturnLink>
      <NextLikeLink href="/owner/members" onNavigate={(href) => childNavigations.push(href)} />
    </MembersReturnLink>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Members" }));
  return profile;
}

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([ROW]);
  replace.mockReset();
  push.mockReset();
  childNavigations = [];
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
  // The return intent is module state; a failed test must not leave one
  // armed for the next test.
  clearMembersReturnIntent();
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/owner/members");
});

describe("the in-app return's navigation", () => {
  // RED: the child's own navigation ran first (it prevents the default
  // and navigates), so the wrapper never armed the intent and the app
  // ended up navigating twice.
  it("navigates exactly once, and the intent is armed before it", async () => {
    await openProfileAndReturn();

    expect(childNavigations, "the child link navigated on its own").toEqual([]);
    expect(replace, "the wrapper did not navigate").toHaveBeenCalledTimes(1);

    // The directory comes back with the search it was left in.
    listMembersAction.mockClear();
    renderBoard();
    await waitFor(() =>
      expect(listMembersAction).toHaveBeenCalledWith(
        expect.objectContaining({ search: "e", locationId: LOCATION }),
      ),
    );
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("e");
  });

  // RED: the scope must survive the return even when the facility
  // cookie is absent — the list's own scope travels in the link.
  it("keeps the facility scope in the return", async () => {
    await openProfileAndReturn();
    expect(replace).toHaveBeenCalledWith(`/owner/members?facility=${LOCATION}`);
  });

  // CONTROL: a modified click belongs to the browser (a new tab), and the
  // wrapper must not take it over.
  it("leaves a modified click to the browser", async () => {
    await openProfileAndReturn();
    replace.mockReset();
    fireEvent.click(screen.getByRole("link", { name: "Members" }), {
      ctrlKey: true,
    });
    expect(replace).not.toHaveBeenCalled();
  });

  // RED: a cancelled effect (StrictMode's double setup) must not lose
  // the intent — the return still restores the directory.
  it("restores after the effect was cancelled", async () => {
    await openProfileAndReturn(true);
    listMembersAction.mockClear();
    renderBoard(true);
    await waitFor(() =>
      expect(listMembersAction).toHaveBeenCalledWith(
        expect.objectContaining({ search: "e" }),
      ),
    );
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("e");
    await flushFrames();
    expect(window.scrollTo).toHaveBeenCalled();
  });
});
