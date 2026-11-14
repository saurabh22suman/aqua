// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), mark: vi.fn() }));
vi.mock("@/lib/actions/announcements", () => ({ listMyNotificationsAction: mocks.list, markNotificationReadAction: mocks.mark }));
import { NotificationInbox } from "@/components/announcements/notification-inbox";

const unread = { id: "n1", title: "Pool closed", body: "Maintenance", announcementId: "a1", readAt: null, createdAt: "2026-11-14T00:00:00Z" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("preserves initial rows and offers retry when the initial refresh rejects", async () => {
  mocks.list.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([unread]);
  render(<NotificationInbox initial={[unread]} />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/refresh/i);
  expect(screen.getByText("Pool closed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
it("preserves unread state and releases the control after an authoritative refusal", async () => {
  mocks.list.mockResolvedValue([unread]);
  mocks.mark.mockResolvedValue({ ok: false, error: "Refused" });
  render(<NotificationInbox initial={[unread]} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not mark/i);
  expect((screen.getByRole("button", { name: "Mark read" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText("1 unread")).toBeTruthy();
});
it("releases the mark-read control after a rejected request", async () => {
  mocks.list.mockResolvedValue([unread]);
  mocks.mark.mockRejectedValue(new Error("offline"));
  render(<NotificationInbox initial={[unread]} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm/i);
  expect((screen.getByRole("button", { name: "Mark read" }) as HTMLButtonElement).disabled).toBe(false);
});
it("ignores an older refresh after a newer successful mark and avoids duplicate clicks", async () => {
  const old = deferred<typeof unread[]>();
  const mark = deferred<{ ok: true }>();
  mocks.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ ...unread, readAt: "2026-11-14T01:00:00Z" }]);
  mocks.mark.mockReturnValue(mark.promise);
  render(<NotificationInbox initial={[unread]} />);
  const button = screen.getByRole("button", { name: "Mark read" });
  fireEvent.click(button); fireEvent.click(button);
  expect(mocks.mark).toHaveBeenCalledTimes(1);
  await act(async () => mark.resolve({ ok: true }));
  await screen.findByText("All read");
  await act(async () => old.resolve([unread]));
  expect(screen.getByText("All read")).toBeTruthy();
});
