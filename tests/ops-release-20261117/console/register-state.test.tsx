// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pending: 0, online: true, savedAtLabel: null as string | null, sessionEnded: false }));
vi.mock("@/lib/hooks/use-offline-register", () => ({ useOfflineRegister: () => ({ marks: {}, mark: vi.fn(), markedCount: 0, pending: state.pending, online: state.online, savedAtLabel: state.savedAtLabel, sessionEnded: state.sessionEnded, saving: 0, hasActiveFailure: false, offlineAvailable: true, retrySync: vi.fn() }) }));
import { RegisterBoard } from "@/components/register-board";
const rows = [{ memberId: "m", name: "Member", code: "M", status: null, pct: 0, isTrial: false }];
afterEach(() => { cleanup(); Object.assign(state, { pending: 0, online: true, savedAtLabel: null, sessionEnded: false }); });
it("describes the initially server-loaded register without claiming a device save", () => {
  render(<RegisterBoard sessionId="s" rows={rows} offlineSyncEnabled />);
  expect(screen.getByTestId("sync-state").textContent).toMatch(/loaded from server/i);
  expect(screen.queryByText(/saved on this phone/i)).toBeNull();
});
it("distinguishes a pending device write", () => {
  state.online = false; state.pending = 1;
  render(<RegisterBoard sessionId="s" rows={rows} offlineSyncEnabled />);
  expect(screen.getByTestId("sync-state").textContent).toMatch(/saved on device/i);
});
it("shows a real acknowledged save time", () => {
  state.savedAtLabel = "05:00 pm";
  render(<RegisterBoard sessionId="s" rows={rows} offlineSyncEnabled />);
  expect(screen.getByTestId("sync-state").textContent).toMatch(/saved at 05:00 pm/i);
});
it("retains expired identity denial", () => {
  state.sessionEnded = true;
  render(<RegisterBoard sessionId="s" rows={rows} offlineSyncEnabled />);
  expect(screen.getByRole("alert").textContent).toMatch(/offline access ended/i);
  expect(screen.queryByTestId("sync-state")).toBeNull();
});
