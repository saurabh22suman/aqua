// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "./fake-indexeddb";

// The kill switch (issue #4 postmortem): a per-tenant flag, default
// off. With it off, the register must fail LOUDLY on connection loss
// instead of queueing silently — no optimistic update, no IndexedDB
// write, a refused tap stays refused. These tests exercise the
// `offlineSyncEnabled = false` branch of useOfflineRegister in
// isolation from the (already-covered) enabled/durability branch in
// use-offline-register.test.tsx.
const markAttendanceSessionAction = vi.fn();
vi.mock("@/lib/actions/coach", () => ({
  markAttendanceSessionAction: (...args: unknown[]) => markAttendanceSessionAction(...args),
}));

function stubOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("useOfflineRegister — offlineSyncEnabled = false", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    markAttendanceSessionAction.mockReset();
    stubOnline(true);
  });

  it("online: marks only after the server action confirms success, not optimistically", async () => {
    installFakeIndexedDB();
    stubOnline(true);
    let resolveAction: (v: { ok: boolean }) => void;
    markAttendanceSessionAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );

    const { useOfflineRegister } = await import("@/lib/hooks/use-offline-register");
    const { result, unmount } = renderHook(() =>
      useOfflineRegister("session-1", [], {}, false),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    act(() => {
      result.current.mark("member-1", "present");
    });

    // The server action hasn't resolved yet — must NOT be marked yet.
    expect(result.current.marks["member-1"]).toBeUndefined();

    await act(async () => {
      resolveAction!({ ok: true });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.marks["member-1"]).toBe("present");
    unmount();
  });

  it("online, server rejects: no mark is recorded and an error is surfaced", async () => {
    installFakeIndexedDB();
    stubOnline(true);
    markAttendanceSessionAction.mockResolvedValue({ ok: false, error: "denied" });

    const { useOfflineRegister } = await import("@/lib/hooks/use-offline-register");
    const { result, unmount } = renderHook(() =>
      useOfflineRegister("session-1", [], {}, false),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    await act(async () => {
      await result.current.mark("member-1", "present");
    });

    expect(result.current.marks["member-1"]).toBeUndefined();
    expect(result.current.hasActiveFailure).toBe(true);
    unmount();
  });

  it("offline: mark() is refused outright — no server call, no DOM update", async () => {
    installFakeIndexedDB();
    stubOnline(false);

    const { useOfflineRegister } = await import("@/lib/hooks/use-offline-register");
    const { result, unmount } = renderHook(() =>
      useOfflineRegister("session-1", [], {}, false),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    await act(async () => {
      await result.current.mark("member-1", "present");
    });

    expect(markAttendanceSessionAction).not.toHaveBeenCalled();
    expect(result.current.marks["member-1"]).toBeUndefined();
    expect(result.current.hasActiveFailure).toBe(true);
    unmount();
  });

  it("never writes to the offline queue when disabled", async () => {
    installFakeIndexedDB();
    stubOnline(true);
    markAttendanceSessionAction.mockResolvedValue({ ok: true });

    const { useOfflineRegister } = await import("@/lib/hooks/use-offline-register");
    const { queueAll } = await import("@/lib/offline/idb");
    const { result, unmount } = renderHook(() =>
      useOfflineRegister("session-1", [], {}, false),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    await act(async () => {
      await result.current.mark("member-1", "present");
    });

    expect(await queueAll()).toHaveLength(0);
    unmount();
  });
});
