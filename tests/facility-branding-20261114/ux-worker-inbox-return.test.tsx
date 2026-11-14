// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationRow } from "@/lib/services/announcements";
const state = vi.hoisted(() => ({ ctx: { roleKey: "worker" }, read: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
vi.mock("@/lib/services/announcements", () => ({ listMyNotifications: state.read }));
vi.mock("@/components/announcements/notification-inbox", () => ({ NotificationInbox: ({ initial }: { initial: NotificationRow[] }) => <p>{initial.length ? initial[0]!.title : "Nothing yet"}</p> }));
import { StaffInboxPage } from "@/components/announcements/staff-inbox-page";
beforeEach(() => { state.ctx.roleKey = "worker"; state.read.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each([false, true])("returns an authorised Worker from an empty/populated inbox (populated=%s)", async (populated) => {
  state.read.mockResolvedValue(populated ? [{ id: "note", title: "Fixture notice", body: "Local only", announcementId: null, readAt: null, createdAt: "2026-11-14T04:00:00Z" }] : []);
  render(await StaffInboxPage({ surface: "worker" }));
  expect(screen.getByRole("link", { name: "Back to My workday" }).getAttribute("href")).toBe("/worker");
  expect(screen.getByText(populated ? "Fixture notice" : "Nothing yet")).toBeTruthy();
  expect(state.read).toHaveBeenCalledWith(state.ctx);
});
it("does not give another role the Worker inbox or read its data", async () => {
  state.ctx.roleKey = "owner";
  await expect(StaffInboxPage({ surface: "worker" })).rejects.toThrow("NOT_FOUND");
  expect(state.read).not.toHaveBeenCalled();
});
it("retains other staff surfaces without a Worker destination", async () => {
  state.ctx.roleKey = "coach";
  render(await StaffInboxPage({ surface: "coach" }));
  expect(screen.queryByRole("link", { name: "Back to My workday" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Announcements" })).toBeTruthy();
});
