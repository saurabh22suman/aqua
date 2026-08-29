// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "./fake-indexeddb";

// mark()'s flush() path calls the real server action on enqueue — mocked
// so this test exercises only the enqueue-durability mechanism (issue
// #4), not sync/network behaviour, which is a separate concern.
vi.mock("@/lib/actions/coach", () => ({
  markAttendanceSessionAction: vi.fn(async () => ({ ok: true })),
}));

// issue #4, mechanism 1: mark() (lib/hooks/use-offline-register.ts)
// fires its write inside a detached, unawaited `void (async () => {
// ... })()`. The click handler that calls it returns before that write
// is guaranteed to have even started durably, let alone finished — no
// caller (a test, or a future safety mechanism) has anything to await,
// because mark() itself returns nothing.
describe("useOfflineRegister — mark() write durability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("mark() returns a promise a caller can await, not void", async () => {
    installFakeIndexedDB();

    const { useOfflineRegister } = await import("@/lib/hooks/use-offline-register");
    const { result, unmount } = renderHook(() => useOfflineRegister("session-1", [], {}, true));

    // Let mount-time effects (kvGet x2, refreshFromQueue) settle first —
    // real timers, real event loop, nothing to fake here.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    let markResult: unknown;
    await act(async () => {
      markResult = result.current.mark("member-1", "present");
      await markResult;
    });

    // Today, mark() has no return statement — this is `undefined`. A
    // caller (or a test) has nothing to await, which is the bug itself,
    // not a downstream symptom of it.
    expect(markResult).toBeInstanceOf(Promise);

    // mark()'s chain kicks off flush() as a background sync step,
    // deliberately not part of what markResult itself waits for — let
    // it settle before unmounting/afterEach tears down the fake
    // indexedDB, or its still-running queries throw into the next test.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    unmount();
  });

  it("mark()'s returned promise does not resolve until the write has actually committed", async () => {
    let committed = false;
    installFakeIndexedDB({
      onTransactionComplete: () => {
        committed = true;
      },
    });

    const { useOfflineRegister } = await import("@/lib/hooks/use-offline-register");
    const { result, unmount } = renderHook(() => useOfflineRegister("session-1", [], {}, true));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Only the commit caused by the mark() call below is under test —
    // mount-time effects already committed their own transactions above.
    committed = false;

    // Deliberately NOT `act(async () => { await markResult })` here — an
    // async act() flushes React's own scheduling, which gives an
    // unrelated, still-running detached background write (today's bug)
    // enough real event-loop time to finish anyway, making the very
    // next assertion pass for the wrong reason (verified: it did, on
    // first draft of this test). A synchronous act() for the
    // state-mutating call, then an explicit, minimal await of exactly
    // what mark() returns and nothing else, is what actually isolates
    // "did awaiting mark() itself wait for the commit" from "did the
    // commit happen to occur anyway while other things were flushed".
    let markResult: unknown;
    act(() => {
      markResult = result.current.mark("member-2", "present");
    });

    if (markResult instanceof Promise) {
      await markResult;
    }

    // If this is false, mark()'s caller was told (or would have been
    // told, once it returns a promise) that the write finished before
    // the underlying transaction actually committed. For today's code,
    // markResult is undefined — nothing was awaited at all, and this
    // must still read false, since not even one microtask has elapsed.
    expect(committed).toBe(true);

    // Let mark()'s background flush() settle before afterEach tears
    // down the fake indexedDB — see the note in the previous test.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    unmount();
  });
});

// issue #4, mechanism 3: mark() now returns a promise that resolves on
// commit (mechanisms 1+2, above) — but its only real caller,
// components/register-board.tsx's `onClick={() => mark(...)}`, discards
// that promise. A click handler can't block a real navigation, so this
// is not "add an await" — but as of today NOTHING a caller in that exact
// shape (or a test driving the UI the same way) can reach knows whether
// the write has landed. Proven at the hook level, not the DOM level:
// this is a property of useOfflineRegister's public surface, not of
// register-board.tsx's JSX.
describe("useOfflineRegister — observing settlement without awaiting mark() itself", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("exposes a way to wait for in-flight writes even when the caller discards mark()'s own promise", async () => {
    let committed = false;
    installFakeIndexedDB({
      onTransactionComplete: () => {
        committed = true;
      },
    });

    const { useOfflineRegister } = await import("@/lib/hooks/use-offline-register");
    const { result, unmount } = renderHook(() => useOfflineRegister("session-1", [], {}, true));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    committed = false;

    // Exactly register-board.tsx's onClick shape: the returned promise
    // is never assigned, never awaited — mimicking `onClick={() => mark(...)}`.
    act(() => {
      result.current.mark("member-3", "present");
    });

    // True both before and after any fix — not what's under test.
    expect(committed).toBe(false);

    // The gap itself: a caller shaped like the real onClick handler has
    // no primitive on the hook to ask "have my in-flight writes landed
    // yet?". Today this is undefined — there is nothing to call.
    const waitForPendingWrites = (
      result.current as unknown as { waitForPendingWrites?: () => Promise<void> }
    ).waitForPendingWrites;
    expect(typeof waitForPendingWrites).toBe("function");
    await waitForPendingWrites!();
    expect(committed).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    unmount();
  });
});
