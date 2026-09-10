// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterBoard } from "@/components/register-board";
import type { RosterRow } from "@/lib/services/register";

// Three-state sync banner on /coach/register/[sessionId].
//
// The hook already exposes every signal the banner needs (pending,
// online, hasActiveFailure, retrySync). What the component USED to
// not do was render anything visible from those signals beyond a
// small `sync-state` text node in the lane strip — a coach marking
// attendance during a connectivity blip had no affirmative signal
// that the mark was durable on the device. This test pins the
// render-side state machine that closed that gap.
//
// State machine (priority order, most-actionable first):
//   1. online && hasActiveFailure  →  red banner, tap = retrySync
//   2. !online && pending > 0      →  amber banner, count of pending
//   3. otherwise                   →  no banner
//
// The kill-switch-off banner (offlineSyncEnabled=false && !online)
// is a separate prior concern and out of scope here.
//
// Mock isolation: vitest runs tests within a file concurrently by
// default. A naive vi.mock + vi.fn() pattern shares one mock across
// every test, so a fast test's mockReturnValue leaks into the slow
// test's render. The fix is the module-level `state` object below
// (mutated synchronously inside each `it`) combined with
// `{ concurrent: false }` on every describe — sequential, each test
// mutates-then-renders-then-asserts with no interleaving.

type BannerState = {
  online: boolean;
  pending: number;
  hasActiveFailure: boolean;
  retrySync: () => Promise<void>;
};

const state: BannerState = {
  online: true,
  pending: 0,
  hasActiveFailure: false,
  retrySync: () => Promise.resolve(),
};

vi.mock("@/lib/hooks/use-offline-register", () => ({
  useOfflineRegister: () => ({
    marks: {} as Record<string, never>,
    mark: () => {},
    markedCount: 0,
    pending: state.pending,
    online: state.online,
    syncedLabel: "never",
    hasActiveFailure: state.hasActiveFailure,
    saving: 0,
    waitForPendingWrites: () => Promise.resolve(),
    retrySync: state.retrySync,
  }),
}));

function row(
  memberId: string,
  name: string,
  status: "present" | "absent" | "late" | null = null,
): RosterRow {
  return {
    memberId,
    name,
    code: memberId.toUpperCase(),
    status,
    pct: 80,
    isTrial: false,
  };
}

const ROWS: RosterRow[] = [row("m1", "Anu"), row("m2", "Bala")];

afterEach(() => {
  // RTL auto-cleanup is on by default in vitest, but the
  // { concurrent: false } serialize path has a known edge case where
  // screen's cached `document.body` retains prior mounts across
  // tests — queryByTestId picks them up as ghosts. Force a fresh
  // document.body before each test runs.
  cleanup();
  state.online = true;
  state.pending = 0;
  state.hasActiveFailure = false;
  state.retrySync = () => Promise.resolve();
});

describe("RegisterBoard sync banner — three-state machine", { concurrent: false }, () => {
  it("online + clean → no sync banner", () => {
    state.online = true;
    state.pending = 0;
    state.hasActiveFailure = false;

    render(<RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />);

    expect(screen.queryByTestId("sync-failure-banner")).toBeNull();
    expect(screen.queryByTestId("pending-sync-banner")).toBeNull();
  });

  it("offline + 3 pending → amber banner with '3 marks saved'", () => {
    state.online = false;
    state.pending = 3;
    state.hasActiveFailure = false;

    render(<RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />);

    const banner = screen.getByTestId("pending-sync-banner");
    expect(banner).not.toBeNull();
    // textContent match — no @testing-library/jest-dom available, and
    // pulling it in just for these two assertions is a new dep.
    expect(banner.textContent).toMatch(/3 marks saved/i);
    expect(banner.textContent).toMatch(/will sync when.*online/i);
    expect(screen.queryByTestId("sync-failure-banner")).toBeNull();
  });

  it("online + active failure → red banner with 'couldn't sync' / 'tap to retry'", () => {
    state.online = true;
    state.pending = 0;
    state.hasActiveFailure = true;

    render(<RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />);

    const banner = screen.getByTestId("sync-failure-banner");
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/couldn't sync/i);
    expect(banner.textContent).toMatch(/tap to retry/i);
    expect(screen.queryByTestId("pending-sync-banner")).toBeNull();
  });
});

describe("RegisterBoard sync banner — mutation-proof", { concurrent: false }, () => {
  // The amber banner's condition is `!online && pending > 0`. If someone
  // drops the `!online` gate, the banner starts firing online too — the
  // test that catches it is "online + pending > 0 + no failure →
  // no amber banner", because online + pending is the lane-strip
  // 'syncing N…' state, not a saved-locally state. The three primary
  // tests above don't trip on this (their pending values are 0 and 3
  // respectively), so this is a separate, explicit regression guard.
  it("online + 5 pending → amber banner must NOT appear", () => {
    state.online = true;
    state.pending = 5;
    state.hasActiveFailure = false;

    render(<RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />);

    expect(screen.queryByTestId("pending-sync-banner")).toBeNull();
    expect(screen.queryByTestId("sync-failure-banner")).toBeNull();
  });
});

describe("RegisterBoard sync banner — retry wiring", { concurrent: false }, () => {
  it("tapping the red banner calls retrySync", () => {
    const retrySync = vi.fn().mockResolvedValue(undefined);
    state.online = true;
    state.pending = 0;
    state.hasActiveFailure = true;
    state.retrySync = retrySync;

    render(<RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />);

    const banner = screen.getByTestId("sync-failure-banner");
    expect(retrySync).not.toHaveBeenCalled();

    // fireEvent over userEvent here on purpose: the latter would add a
    // second devDependency (AGENTS.md: no new dependency without
    // asking), and a click handler that ignores the event object is
    // exactly the shape fireEvent covers — no keyboard / pointer
    // sequencing needed for this assertion.
    fireEvent.click(banner);

    expect(retrySync).toHaveBeenCalledTimes(1);
  });
});
