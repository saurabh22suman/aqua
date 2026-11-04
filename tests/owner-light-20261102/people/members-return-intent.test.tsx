// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the in-app return from a
// member profile, and the empty directory's create link.
//
// Review finding (HOME lane, REVIEW-PEOPLE.md):
//
//   F1 — the profile's in-app "Members" link is a plain Link to a FRESH
//        directory: tapping it loses the search, the status filter and
//        the scroll position. Only the browser Back button restored them.
//   F2 — the empty directory's "Add your first member" CTA opens the add
//        form WITHOUT the selected facility, while the contextual create
//        action carries it.
//
// The journey under test is the real one: the list, then the profile's
// in-app Members link, then the list again — restored, scoped and
// filtered. Browser Back keeps its own path (the existing popstate
// restoration is untouched and still covered by
// members-directory-navigation.test.tsx).
//
// No database: the only server action the board reaches is stubbed.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMembersAction = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
}));

import { MembersBoard } from "@/components/members-board";
import { MembersReturnLink } from "@/components/members-return-link";
import { BackLink } from "@/components/ui/BackLink";
import type { MemberListRow } from "@/lib/services/people";

const KEY = "tenant-1:user-1";
const OTHER_KEY = "tenant-1:user-9";
const LOCATION = "loc-1";
const OTHER_LOCATION = "loc-2";

// The status filter is a group of chips; the pressed chip is the current
// selection.
function statusChip(name: string) {
  return within(screen.getByRole("group", { name: "Status" })).getByRole("button", {
    name,
  });
}

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

function renderBoard(options: { namespace?: string; locationId?: string; members?: MemberListRow[] } = {}) {
  return render(
    <MembersBoard
      initialMembers={options.members ?? [ROW]}
      initialLocationId={options.locationId ?? LOCATION}
      navigationNamespace={options.namespace ?? KEY}
    />,
  );
}

/** The control the member profile renders above its title. */
function renderProfileBackControl() {
  return render(
    <MembersReturnLink>
      <BackLink href="/owner/members" label="Members" />
    </MembersReturnLink>,
  );
}

beforeEach(() => {
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([ROW]);
  replace.mockReset();
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

describe("the in-app return from a member profile", () => {
  // RED: the profile's in-app Members link opens a FRESH directory — the
  // search, the status filter and the scroll position are lost.
  it("restores the search, the status filter and the scroll position", async () => {
    const list = renderBoard();

    fireEvent.change(screen.getByTestId("members-search"), {
      target: { value: "e" },
    });
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(1));
    fireEvent.click(statusChip("Active"));
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(2));

    // The owner opens a profile from a scrolled, filtered list.
    (window as unknown as { scrollY: number }).scrollY = 480;
    fireEvent.click(screen.getAllByTestId("member-row")[0]!);

    // The profile replaces the list; its in-app Members link is pressed.
    list.unmount();
    const profile = renderProfileBackControl();
    fireEvent.click(screen.getByRole("link", { name: "Members" }));
    // The return keeps the scope the directory was read under: the
    // facility cookie may be absent, so the link carries it.
    expect(replace, "the in-app Members link did not navigate").toHaveBeenCalledWith(
      `/owner/members?facility=${LOCATION}`,
    );

    // The list is shown again.
    profile.unmount();
    listMembersAction.mockClear();
    renderBoard();
    await waitFor(() =>
      expect(listMembersAction).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "e",
          status: "active",
          locationId: LOCATION,
        }),
      ),
    );
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("e");
    expect(statusChip("Active").getAttribute("aria-pressed")).toBe("true");
    await flushFrames();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 480);
  });

  // RED: a modified click opens another tab or window. That tab has no
  // in-memory intent, so the link must NOT be intercepted.
  it("does not intercept a modified click", () => {
    renderProfileBackControl();
    const link = screen.getByRole("link", { name: "Members" });
    fireEvent.click(link, { ctrlKey: true });
    expect(replace).not.toHaveBeenCalled();
    expect(link.getAttribute("href")).toBe("/owner/members");
  });

  // CONTROL: a fresh visit to the directory adopts nothing.
  it("adopts nothing on a fresh visit", async () => {
    renderBoard();
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(0));
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("");
    expect(statusChip("All").getAttribute("aria-pressed")).toBe("true");
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  // CONTROL: another account's list, and another facility's list, never
  // adopt the intent.
  it("is not adopted by another account's or another facility's list", async () => {
    const list = renderBoard();
    fireEvent.change(screen.getByTestId("members-search"), {
      target: { value: "e" },
    });
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(1));
    (window as unknown as { scrollY: number }).scrollY = 480;
    fireEvent.click(screen.getAllByTestId("member-row")[0]!);
    list.unmount();

    const profile = renderProfileBackControl();
    fireEvent.click(screen.getByRole("link", { name: "Members" }));
    profile.unmount();

    // Another actor's directory.
    listMembersAction.mockClear();
    renderBoard({ namespace: OTHER_KEY });
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(0));
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("");

    // Another facility's directory, for the same actor.
    cleanup();
    listMembersAction.mockClear();
    renderBoard({ locationId: OTHER_LOCATION });
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(0));
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("");
  });

  // CONTROL: the intent is single use. The second arrival is a fresh
  // directory, not a second restore.
  it("restores once only", async () => {
    const list = renderBoard();
    fireEvent.change(screen.getByTestId("members-search"), {
      target: { value: "e" },
    });
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByTestId("member-row")[0]!);
    list.unmount();

    const profile = renderProfileBackControl();
    fireEvent.click(screen.getByRole("link", { name: "Members" }));
    profile.unmount();

    renderBoard();
    await waitFor(() =>
      expect(listMembersAction).toHaveBeenCalledWith(
        expect.objectContaining({ search: "e" }),
      ),
    );
    cleanup();

    listMembersAction.mockClear();
    renderBoard();
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(0));
    expect((screen.getByTestId("members-search") as HTMLInputElement).value).toBe("");
  });
});
