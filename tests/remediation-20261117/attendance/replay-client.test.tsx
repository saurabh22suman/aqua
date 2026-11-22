// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/coach", () => ({ markAttendanceSessionAction: send }));
import { useOfflineRegister } from "@/lib/hooks/use-offline-register";
import { activateOfflineIdentity, enqueueMark, queueAll } from "@/lib/offline/idb";
import { replayAttendance } from "@/lib/offline/replay";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("retains a refused mark but syncs another member and reports the real pending count", async () => {
  installFakeIndexedDB();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const identity = { scope: "a".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  const base = { sessionId: "session", status: "present" as const, attempts: 0, ...identity };
  await enqueueMark({ ...base, memberId: "first", clientId: "first-op", savedAt: Date.now() - 10 });
  await enqueueMark({ ...base, memberId: "second", clientId: "second-op", savedAt: Date.now() });
  send.mockImplementation(async input => input.memberId === "first" ? { ok: false, code: "terminal", error: "Review this mark." } : { ok: true });
  const hook = renderHook(() => useOfflineRegister("session", [], {}, true, identity));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(async () => { await hook.result.current.retrySync(); });
  expect((await queueAll()).map(row => row.clientId)).toEqual(["first-op"]);
  expect(hook.result.current.pending).toBe(1);
  hook.unmount();
});
it("blocks later marks for a review target but syncs unrelated marks", async () => {
  installFakeIndexedDB();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } });
  const identity = { scope: "b".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  const base = { sessionId: "session", status: "present" as const, attempts: 0, ...identity };
  await enqueueMark({ ...base, memberId: "one", clientId: "a", savedAt: 1 });
  await enqueueMark({ ...base, memberId: "one", clientId: "b", savedAt: 2 });
  await enqueueMark({ ...base, memberId: "two", clientId: "c", savedAt: 3 });
  send.mockImplementation(async input => input.clientId === "a" ? { ok: false, code: "terminal" } : { ok: true });
  await replayAttendance(identity);
  expect(send.mock.calls.map(call => call[0].clientId)).toEqual(["a", "c"]);
  expect((await queueAll()).map(row => [row.clientId, row.review])).toEqual([["a", true], ["b", undefined]]);
});
it("only one of two callers sends an operation while the first request is unresolved", async () => {
  installFakeIndexedDB();
  let held = false;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
    if (held) return callback(null);
    held = true;
    try { return await callback({}); } finally { held = false; }
  } } });
  const identity = { scope: "c".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, sessionId: "session", memberId: "one", status: "present", attempts: 0, clientId: "a", savedAt: 1 });
  let finish!: (value: { ok: boolean }) => void, started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  send.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const first = replayAttendance(identity);
  await began;
  await replayAttendance(identity);
  expect(send).toHaveBeenCalledTimes(1);
  finish({ ok: true });
  await first;
  expect(await queueAll()).toEqual([]);
});
it("securely purges invalid session marks and stops when reauthentication is required", async () => {
  installFakeIndexedDB();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } });
  const identity = { scope: "d".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  for (const [clientId, memberId, savedAt] of [["a", "one", 1], ["b", "two", 2]] as const) {
    await enqueueMark({ ...identity, sessionId: "session", memberId, status: "present", attempts: 0, clientId, savedAt });
  }
  send.mockResolvedValue({ ok: false, code: "reauth", error: "Sign in again." });
  expect(await replayAttendance(identity)).toEqual({ error: "Sign in again." });
  expect(send).toHaveBeenCalledTimes(1);
  expect(await queueAll()).toEqual([]);
});
it("reports a timeout while retaining the lock until the original request settles", async () => {
  installFakeIndexedDB();
  let held = false;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
    if (held) return callback(null);
    held = true; try { return await callback({}); } finally { held = false; }
  } } });
  const identity = { scope: "e".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, sessionId: "s", memberId: "m", status: "present", attempts: 0, clientId: "a", savedAt: 1 });
  let finish!: (result: { ok: boolean }) => void;
  send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const replay = replayAttendance as (value: typeof identity, timeoutMs: number) => Promise<{ error: string | null }>;
  const outcome = await Promise.race([replay(identity, 10), new Promise<null>(resolve => setTimeout(() => resolve(null), 150))]);
  expect(outcome?.error).toMatch(/timed out/i);
  expect(held).toBe(true);
  await enqueueMark({ ...identity, sessionId: "s", memberId: "m", status: "absent", attempts: 0, clientId: "b", savedAt: 2 });
  await replayAttendance(identity);
  expect(send).toHaveBeenCalledTimes(1);
  finish({ ok: true });
  await new Promise(resolve => setTimeout(resolve, 30));
  send.mockResolvedValue({ ok: true });
  await replayAttendance(identity);
  expect(send.mock.calls.map(call => call[0].clientId)).toEqual(["a", "b"]);
  expect(await queueAll()).toEqual([]);
});
it("fails closed without cross-tab locks, retaining queued marks", async () => {
  installFakeIndexedDB();
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  const identity = { scope: "f".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, sessionId: "s", memberId: "m", status: "present", attempts: 0, clientId: "a", savedAt: 1 });
  expect((await replayAttendance(identity)).error).toMatch(/unavailable/i);
  expect(send).not.toHaveBeenCalled();
  expect(await queueAll()).toHaveLength(1);
});
it("counts a review mark and restores the server status when it is discarded", async () => {
  installFakeIndexedDB();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const identity = { scope: "1".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, sessionId: "session", memberId: "m", status: "present", attempts: 0, clientId: "a", savedAt: 1, review: true });
  const hook = renderHook(() => useOfflineRegister("session", [], { m: "absent" }, true, identity));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(hook.result.current.pending).toBe(1);
  expect(hook.result.current.marks.m).toBe("present");
  expect(hook.result.current.review).toHaveLength(1);
  await act(async () => { await hook.result.current.discardReview("a"); });
  expect(hook.result.current.pending).toBe(0);
  expect(hook.result.current.marks.m).toBe("absent");
  hook.unmount();
});
