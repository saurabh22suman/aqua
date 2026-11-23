// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/coach", () => ({ markAttendanceSessionAction: send }));
import { useOfflineRegister } from "@/lib/hooks/use-offline-register";
import { RegisterBoard } from "@/components/register-board";
import { activateOfflineIdentity, enqueueMark, kvGet, scopedKvSet } from "@/lib/offline/idb";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function setup() {
  installFakeIndexedDB();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } });
  const identity = { scope: "a".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, sessionId: "session", memberId: "member", status: "present", attempts: 0, clientId: "review-op", savedAt: 1, review: true });
  const previous = Date.now() - 120000;
  await scopedKvSet(identity, "lastSynced", { at: previous });
  return { identity, previous };
}

it("shows review-required rather than syncing for a review-only register", async () => {
  const { identity } = await setup();
  render(<RegisterBoard sessionId="session" rows={[]} offlineSyncEnabled offlineIdentity={identity} />);
  await waitFor(() => expect(screen.getByTestId("sync-state").getAttribute("data-sync-state")).toBe("review"));
  expect(screen.getByTestId("sync-state").textContent).toMatch(/1 pending.*1 need review/i);
  expect(screen.getByText(/1 unsynced mark needs review/i)).toBeTruthy();
});

it("distinguishes retryable marks from later marks blocked behind review", async () => {
  const { identity } = await setup();
  const base = { ...identity, sessionId: "session", status: "absent" as const, attempts: 0 };
  await enqueueMark({ ...base, memberId: "member", clientId: "blocked", savedAt: 2 });
  await enqueueMark({ ...base, memberId: "other", clientId: "retryable", savedAt: 3 });
  render(<RegisterBoard sessionId="session" rows={[]} offlineSyncEnabled offlineIdentity={identity} />);
  await waitFor(() => expect(screen.getByTestId("sync-state").textContent).toMatch(/1 need review · 1 pending sync/i));
  expect(screen.getByTestId("sync-state").textContent).toMatch(/3 pending/i);
  expect(screen.getByTestId("sync-state").getAttribute("data-sync-state")).toBe("review");
});

it("explains ordinary offline replay and expiry without claiming review-only marks will sync", async () => {
  const { identity } = await setup();
  const base = { ...identity, sessionId: "session", status: "absent" as const, attempts: 0 };
  await enqueueMark({ ...base, memberId: "other", clientId: "retryable", savedAt: 3 });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  render(<RegisterBoard sessionId="session" rows={[]} offlineSyncEnabled offlineIdentity={identity} />);
  await waitFor(() => expect(screen.getByTestId("pending-sync-banner").textContent).toMatch(/will sync when.*online/i));
  expect(screen.getByTestId("pending-sync-banner").textContent).toMatch(/expires or you sign out/i);
  expect(screen.getByTestId("sync-state").getAttribute("data-sync-state")).toBe("review");
});

it("does not promise automatic sync for review-only offline marks", async () => {
  const { identity } = await setup();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  render(<RegisterBoard sessionId="session" rows={[]} offlineSyncEnabled offlineIdentity={identity} />);
  await waitFor(() => expect(screen.getByTestId("sync-state").getAttribute("data-sync-state")).toBe("review"));
  expect(screen.getByTestId("pending-sync-banner").textContent).not.toMatch(/will sync when.*online/i);
  expect(screen.getByTestId("pending-sync-banner").textContent).toMatch(/expires or you sign out/i);
});

it("does not advance the previous successful sync on a review-only retry", async () => {
  const { identity, previous } = await setup();
  const hook = renderHook(() => useOfflineRegister("session", [], {}, true, identity));
  await waitFor(() => expect(hook.result.current.pending).toBe(1));
  await waitFor(() => expect(hook.result.current.savedAtLabel).not.toBeNull());
  const previousLabel = hook.result.current.savedAtLabel;
  await act(async () => { await hook.result.current.retrySync(); });
  expect(await kvGet(`${identity.scope}:lastSynced`)).toEqual({ at: previous });
  expect(hook.result.current.savedAtLabel).toBe(previousLabel);
  expect(hook.result.current.review).toHaveLength(1);
  expect(hook.result.current.pending).toBe(1);
  expect(send).not.toHaveBeenCalled();
  hook.unmount();
});

it("reports the actual successful mark while retaining review and a recoverable same-millisecond failure", async () => {
  const { identity, previous } = await setup();
  const base = { ...identity, sessionId: "session", status: "present" as const, attempts: 0 };
  await enqueueMark({ ...base, memberId: "member", clientId: "blocked-op", savedAt: 2 });
  await enqueueMark({ ...base, memberId: "other", clientId: "ok-op", savedAt: 3 });
  await enqueueMark({ ...base, memberId: "third", clientId: "retry-op", savedAt: 4 });
  const hook = renderHook(() => useOfflineRegister("session", [], {}, true, identity));
  await waitFor(() => expect(hook.result.current.pending).toBe(4));
  expect(hook.result.current.retryable).toBe(2);
  const now = previous + 60000;
  vi.spyOn(Date, "now").mockReturnValue(now);
  send.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await hook.result.current.retrySync(); });
  expect(await kvGet(`${identity.scope}:lastSynced`)).toEqual({ at: now });
  expect(hook.result.current.hasActiveFailure).toBe(true);
  expect(hook.result.current.pending).toBe(3);
  expect(hook.result.current.retryable).toBe(1);
  expect(hook.result.current.review).toHaveLength(1);
  send.mockResolvedValueOnce({ ok: true });
  await act(async () => { await hook.result.current.retrySync(); });
  expect(hook.result.current.hasActiveFailure).toBe(false);
  expect(hook.result.current.pending).toBe(2);
  expect(hook.result.current.retryable).toBe(0);
  vi.restoreAllMocks();
  hook.unmount();
});

it("keeps a later queued correction after discarding a review mark", async () => {
  const { identity } = await setup();
  await enqueueMark({ ...identity, sessionId: "session", memberId: "member", status: "late", attempts: 0, clientId: "later-op", savedAt: 2 });
  const hook = renderHook(() => useOfflineRegister("session", [], { member: "absent" }, true, identity));
  await waitFor(() => expect(hook.result.current.pending).toBe(2));
  expect(hook.result.current.retryable).toBe(0);
  await act(async () => { await hook.result.current.discardReview("review-op"); });
  expect(hook.result.current.pending).toBe(1);
  expect(hook.result.current.retryable).toBe(1);
  expect(hook.result.current.marks.member).toBe("late");
  hook.unmount();
});

it("does not revive older scope-bound error metadata after a successful sync", async () => {
  const { identity, previous } = await setup();
  await scopedKvSet(identity, "lastError", { at: previous - 1, message: "old failure" });
  const hook = renderHook(() => useOfflineRegister("session", [], {}, true, identity));
  await waitFor(() => expect(hook.result.current.savedAtLabel).not.toBeNull());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(hook.result.current.hasActiveFailure).toBe(false);
  hook.unmount();
});

it("rehydrates a same-millisecond failure until a successful retry clears it", async () => {
  const { identity, previous } = await setup();
  await enqueueMark({ ...identity, sessionId: "session", memberId: "other", status: "absent", attempts: 0, clientId: "retry-op", savedAt: 2 });
  await scopedKvSet(identity, "lastError", { at: previous, message: "network unavailable" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const first = renderHook(() => useOfflineRegister("session", [], {}, true, identity));
  await waitFor(() => expect(first.result.current.hasActiveFailure).toBe(true));
  expect(first.result.current.pending).toBe(2);
  expect(first.result.current.retryable).toBe(1);
  first.unmount();
  const remounted = renderHook(() => useOfflineRegister("session", [], {}, true, identity));
  await waitFor(() => expect(remounted.result.current.hasActiveFailure).toBe(true));
  expect(remounted.result.current.pending).toBe(2);
  expect(remounted.result.current.retryable).toBe(1);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  send.mockResolvedValueOnce({ ok: true });
  await act(async () => { await remounted.result.current.retrySync(); });
  expect(remounted.result.current.hasActiveFailure).toBe(false);
  expect(remounted.result.current.pending).toBe(1);
  expect(await kvGet(`${identity.scope}:lastError`)).toBeNull();
  remounted.unmount();
});
