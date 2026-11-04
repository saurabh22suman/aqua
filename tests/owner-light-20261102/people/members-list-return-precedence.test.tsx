// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the directory return after a
// profile Edit → Cancel.
//
// Root's scoped Chrome journey now gets past Notes and reaches the directory,
// but the directory comes back EMPTY: no search, no Active status, 17 rows
// instead of the 1 filtered row. The hypothesis under test: the Edit → Cancel
// `router.back()` leaves the module `navigationIntent` flag set from popstate,
// so the next directory mount consumes that flag FIRST and reads the current
// (profile/Notes) history entry — ignoring the valid ARMED return the profile's
// Members link recorded.
//
// These rendered hook tests pin the precedence: a valid matching armed return
// wins, exactly one restore is attempted, and every non-matching context keeps
// today's behaviour.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMembersReturnIntent,
  consumeMembersListNavigationIntent,
  peekMembersReturnIntent,
  recordMembersReturnIntent,
  useMembersListNavigation,
  type MembersListNavigationState,
} from "@/components/members-list-navigation";

const NAMESPACE = "tenant-1:user-1";
const FACILITY = "22222222-2222-4222-8222-222222222222";
const OTHER_FACILITY = "44444444-4444-4444-8444-444444444444";
const STATE_KEY = "ownerMembersList";

const SCOPED: MembersListNavigationState = {
  namespace: NAMESPACE,
  locationId: FACILITY,
  search: "Aaradhya",
  status: "active",
  scrollY: 480,
};

function Harness({
  apply,
  namespace = NAMESPACE,
  locationId = FACILITY,
}: {
  apply: (state: MembersListNavigationState) => Promise<boolean>;
  namespace?: string;
  locationId?: string;
}) {
  useMembersListNavigation({ namespace, locationId, apply });
  return null;
}

function armIntent(state: MembersListNavigationState) {
  recordMembersReturnIntent(state);
  // The profile's Members link arms the record before navigating.
  // armMembersReturnIntent is the exported arming call.
  arm();
}

// Imported lazily so the module list above stays readable.
import { armMembersReturnIntent as arm } from "@/components/members-list-navigation";

/** The popstate a profile Edit → Cancel leaves behind. */
function stalePopstate() {
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

beforeEach(() => {
  clearMembersReturnIntent();
  consumeMembersListNavigationIntent();
  window.history.replaceState(null, "", "/owner/members");
  window.scrollTo = vi.fn();
});

afterEach(cleanup);

describe("the directory return precedence", () => {
  // RED: the stale popstate won, the armed return was ignored, and the
  // directory came back unfiltered.
  it("restores the armed scoped return despite a stale popstate", async () => {
    const apply = vi.fn(async () => true);
    armIntent(SCOPED);
    stalePopstate();
    render(<Harness apply={apply} />);
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(SCOPED);
    // The authoritative restore reached the scroll step.
    expect(window.scrollTo).toHaveBeenCalledWith(0, SCOPED.scrollY);
    // The intent is spent, not left to leak into a later mount.
    expect(peekMembersReturnIntent(NAMESPACE, FACILITY)).toBeNull();
  });

  // CONTROL: a later fresh mount must not replay the stale popstate.
  it("does not replay the consumed popstate on a later mount", async () => {
    const first = vi.fn(async () => true);
    armIntent(SCOPED);
    stalePopstate();
    const view = render(<Harness apply={first} />);
    await settle();
    view.unmount();
    cleanup();
    const second = vi.fn(async () => true);
    render(<Harness apply={second} />);
    await settle();
    expect(second).not.toHaveBeenCalled();
  });

  // CONTROL: the browser's own Back/Forward still restores the entry state.
  it("keeps the history restore for a real Back/Forward", async () => {
    const apply = vi.fn(async () => true);
    const stored = { ...SCOPED, search: "rao", status: "active", scrollY: 120 };
    window.history.replaceState({ [STATE_KEY]: stored }, "", "/owner/members");
    stalePopstate();
    render(<Harness apply={apply} />);
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(stored);
  });

  // CONTROL: another tenant/actor never inherits the armed return.
  it("ignores an armed return for another namespace", async () => {
    const apply = vi.fn(async () => true);
    armIntent({ ...SCOPED, namespace: "tenant-1:user-2" });
    stalePopstate();
    render(<Harness apply={apply} />);
    await settle();
    expect(apply).not.toHaveBeenCalled();
  });

  // CONTROL: another facility never inherits the armed return.
  it("ignores an armed return for another facility", async () => {
    const apply = vi.fn(async () => true);
    armIntent({ ...SCOPED, locationId: OTHER_FACILITY });
    stalePopstate();
    render(<Harness apply={apply} />);
    await settle();
    expect(apply).not.toHaveBeenCalled();
  });

  // CONTROL: an invalid stored state never leaks filters.
  it("ignores an invalid stored history state", async () => {
    const apply = vi.fn(async () => true);
    window.history.replaceState(
      { [STATE_KEY]: { namespace: NAMESPACE, locationId: FACILITY, search: 7 } },
      "",
      "/owner/members",
    );
    stalePopstate();
    render(<Harness apply={apply} />);
    await settle();
    expect(apply).not.toHaveBeenCalled();
  });

  // CONTROL: a fresh directory stays fresh.
  it("leaves a fresh directory untouched", async () => {
    const apply = vi.fn(async () => true);
    render(<Harness apply={apply} />);
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  // CONTROL: a refused/failed restore never scrolls.
  it("does not scroll when the restore is refused", async () => {
    const apply = vi.fn(async () => false);
    armIntent(SCOPED);
    stalePopstate();
    render(<Harness apply={apply} />);
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
