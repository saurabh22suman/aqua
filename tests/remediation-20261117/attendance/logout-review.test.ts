// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";
const send = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/coach", () => ({ markAttendanceSessionAction: send }));
vi.mock("@/lib/offline/client-session", () => ({ readOfflineSessionState: state, clearOfflineData: vi.fn() }));
import { activateOfflineIdentity, enqueueMark } from "@/lib/offline/idb";
import { syncBeforeLogout } from "@/lib/offline/logout";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("counts review marks as pending at logout without resending them", async () => {
  installFakeIndexedDB();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } });
  const identity = { scope: "2".repeat(64), expiresAt: Date.now() + 60000 };
  state.mockResolvedValue({ authenticated: true, identity });
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, sessionId: "s", memberId: "m", status: "present", attempts: 0, clientId: "a", savedAt: 1, review: true });
  expect(await syncBeforeLogout()).toBe(1);
  expect(send).not.toHaveBeenCalled();
});
