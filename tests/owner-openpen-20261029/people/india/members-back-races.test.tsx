// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Races around history-state scroll restoration. These are rendered regressions:
// the list must not scroll after a failed refresh, after newer user input, or
// after unmount.

const listMembersAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { MembersBoard } from "@/components/members-board";

const KEY = "tenant:actor";
const LOCATION = "loc-1";

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

beforeEach(() => {
  listMembersAction.mockReset();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  window.history.replaceState(
    {
      ownerMembersList: {
        namespace: KEY,
        locationId: LOCATION,
        search: "e",
        status: "",
        scrollY: 480,
      },
    },
    "",
    "/owner/members",
  );
  Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/owner/members");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderBoard() {
  return render(
    <MembersBoard
      initialMembers={[]}
      initialLocationId={LOCATION}
      navigationNamespace={KEY}
    />,
  );
}

async function applyHistoryState() {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

describe("members history restoration races", () => {
  it("does not restore scroll when the authoritative refresh fails", async () => {
    listMembersAction.mockRejectedValue(new Error("offline"));
    renderBoard();
    await applyHistoryState();
    await waitFor(() => expect(listMembersAction).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    await flushFrames();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("does not restore old scroll after newer user input", async () => {
    const old = deferred<never[]>();
    listMembersAction
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce([]);
    renderBoard();
    await applyHistoryState();
    await waitFor(() => expect(listMembersAction).toHaveBeenCalledTimes(1));

    fireEvent.change(document.querySelector('[data-testid="members-search"]')!, {
      target: { value: "new" },
    });
    await act(async () => {
      old.resolve([]);
      await Promise.resolve();
    });
    await flushFrames();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("cancels scheduled restore frames when unmounted", async () => {
    listMembersAction.mockResolvedValue([]);
    const view = renderBoard();
    await applyHistoryState();
    await waitFor(() => expect(listMembersAction).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    view.unmount();
    await flushFrames();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
