// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RegisterBoard } from "@/components/register-board";
import type { RosterRow } from "@/lib/actions/coach";
import { queueForIdentity } from "@/lib/offline/idb";
import { installFakeIndexedDB } from "./fake-indexeddb";
import { OFFLINE_IDENTITY } from "./fixture-identity";

const mocks = vi.hoisted(() => ({
  mark: vi.fn(),
  failEnqueue: false,
  attempts: [] as string[],
}));
vi.mock("@/lib/actions/coach", () => ({ markAttendanceSessionAction: mocks.mark }));
vi.mock("@/lib/offline/idb", async (importOriginal) => {
  const db = await importOriginal<typeof import("@/lib/offline/idb")>();
  return {
    ...db,
    enqueueMark: async (entry: Parameters<typeof db.enqueueMark>[0]) => {
      mocks.attempts.push(entry.clientId);
      if (mocks.failEnqueue) throw new Error("Device storage unavailable");
      await db.enqueueMark(entry);
    },
  };
});

const rows = [{ memberId: "member-1", name: "Mira", pct: null, status: null }] as RosterRow[];

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setOnline(true);
  mocks.mark.mockReset();
  mocks.failEnqueue = false;
  mocks.attempts.length = 0;
});

it("reports an enqueue failure as unsaved and retries the same mark into the durable queue", async () => {
  installFakeIndexedDB();
  const previousLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) },
  });
  try {
  setOnline(false);
  mocks.failEnqueue = true;
  const { unmount } = render(<RegisterBoard sessionId="session-1" rows={rows} offlineSyncEnabled offlineIdentity={OFFLINE_IDENTITY} />);
  const present = screen.getByRole("button", { name: "Present" });
  fireEvent.click(present);
  const retry = await screen.findByRole("button", { name: "Retry mark for Mira" });
  expect(screen.getByRole("alert").textContent).toMatch(/mark did not save/i);
  expect(present.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByText(/marks? saved locally/i)).toBeNull();
  expect(await queueForIdentity(OFFLINE_IDENTITY)).toHaveLength(0);

  mocks.failEnqueue = false;
  retry.focus();
  fireEvent.click(retry);
  await screen.findByText(/1 mark saved locally/i);
  expect(document.activeElement).toBe(present.closest("li"));
  expect(await queueForIdentity(OFFLINE_IDENTITY)).toMatchObject([{ memberId: "member-1", status: "present" }]);
  expect(mocks.attempts).toEqual([mocks.attempts[0], mocks.attempts[0]]);
  unmount();
  render(<RegisterBoard sessionId="session-1" rows={rows} offlineSyncEnabled offlineIdentity={OFFLINE_IDENTITY} />);
  await screen.findByText(/1 mark saved locally/i);
  expect(screen.getByRole("button", { name: "Present" }).getAttribute("aria-pressed")).toBe("true");

  mocks.mark.mockResolvedValue({ ok: true });
  setOnline(true);
  fireEvent(window, new Event("online"));
  await waitFor(() => expect(screen.getByTestId("sync-state").getAttribute("data-sync-state")).toBe("synced"));
  expect(mocks.mark).toHaveBeenCalledTimes(1);
  expect(await queueForIdentity(OFFLINE_IDENTITY)).toHaveLength(0);
  } finally {
    if (previousLocks) Object.defineProperty(navigator, "locks", previousLocks);
    else Reflect.deleteProperty(navigator, "locks");
  }
});

it("retries an unconfirmed online-only mark with the same request identity", async () => {
  installFakeIndexedDB();
  setOnline(true);
  mocks.mark.mockRejectedValueOnce(new Error("Reply lost")).mockResolvedValueOnce({ ok: true });
  render(<RegisterBoard sessionId="session-1" rows={rows} offlineSyncEnabled={false} />);

  fireEvent.click(screen.getByRole("button", { name: "Present" }));
  const retry = await screen.findByRole("button", { name: "Retry mark for Mira" });
  expect(screen.getByRole("alert").textContent).toMatch(/mark.*not confirmed/i);
  expect(screen.queryByTestId("sync-failure-banner")).toBeNull();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole("button", { name: "Present" }).getAttribute("aria-pressed")).toBe("true"));
  expect(mocks.mark).toHaveBeenCalledTimes(2);
  expect(mocks.mark.mock.calls[1]).toEqual(mocks.mark.mock.calls[0]);
  expect(screen.queryByRole("button", { name: "Retry mark for Mira" })).toBeNull();
});
