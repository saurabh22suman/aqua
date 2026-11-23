// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationInbox } from "@/components/announcements/notification-inbox";
import { SelfInboxPage } from "@/components/announcements/self-inbox-page";
import { StaffInboxPage } from "@/components/announcements/staff-inbox-page";
import { SelfBilling } from "@/components/self-billing";
import { SelfHome } from "@/components/self-home";
import type { SelfHomeView } from "@/lib/services/self-home";

const state = vi.hoisted(() => ({
  role: "coach",
  staffRead: vi.fn(),
  selfRead: vi.fn(),
  refresh: vi.fn(),
  markStaff: vi.fn(),
  markSelf: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({ roleKey: state.role }),
  NotFoundError: class extends Error {},
}));
vi.mock("@/lib/auth/self-scope", () => ({ resolveSelfScope: async () => ({ read: state.selfRead }) }));
vi.mock("@/lib/services/announcements", () => ({
  listMyNotifications: state.staffRead,
  readSelfNotificationsInTx: vi.fn(),
}));
vi.mock("@/lib/actions/announcements", () => ({
  listMyNotificationsAction: state.refresh,
  markNotificationReadAction: state.markStaff,
}));
vi.mock("@/lib/actions/self-notifications", () => ({ markSelfNotificationAction: state.markSelf }));

const notice = {
  id: "notice-1", title: "Morning lane changes", body: "Start warm-up in lane 1.",
  announcementId: null, readAt: null, createdAt: "2026-11-21T02:00:00.000Z",
};
const earlier = { ...notice, id: "notice-2", title: "Evening entry", readAt: "2026-11-21T03:00:00.000Z" };
const view: SelfHomeView = {
  clubName: "Aqua Worli", audience: "member",
  entries: [{ memberId: "rohan", memberCode: "SELF-1", status: "active", fullName: "Rohan Mehta", facilityName: "Worli Main" }],
};

beforeEach(() => {
  state.staffRead.mockResolvedValue([notice, earlier]);
  state.selfRead.mockResolvedValue([notice, earlier]);
  state.refresh.mockResolvedValue([notice, earlier]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("anchors the member work with their identity and offers a retry when fee access is unavailable", () => {
  render(<SelfHome view={view} audience="member" scopeKind="self_session" tenantId="club" />);
  expect(screen.getByRole("heading", { level: 1, name: "Rohan Mehta" })).toBeTruthy();
  expect(screen.getByText(/SELF-1.*Worli Main/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Retry fees access" }).getAttribute("href")).toBe("/member");
  expect(screen.getByRole("link", { name: "Your achievements page" }).getAttribute("href")).toBe("/member/showcase");
});

it("totals only the displayed fees exactly and jumps to payments without changing the receipt form", () => {
  render(<SelfBilling homeHref="/member" receiptBase="/api/self/billing/receipt" data={{
    outstanding: Array.from({ length: 10 }, (_, index) => ({
      id: "fee-" + index, invoiceNumber: "NOV-" + index, dueOn: "2026-11-23", status: "partial",
      totalPaise: 300005, paidPaise: 100000, outstandingPaise: 200005,
    })),
    payments: [{ id: "payment", invoiceNumber: "NOV-1", receivedAt: "2026-11-19T00:00:00Z", method: "upi", amountPaise: 100000 }],
  }} />);
  expect(screen.getByRole("region", { name: "Balance on invoices shown" }).textContent).toContain("₹20,000.50");
  expect(screen.getByRole("link", { name: "Payments and receipts" }).getAttribute("href")).toBe("#payments-title");
  const receipt = screen.getByRole("button", { name: /Download receipt for NOV-1/ });
  expect(receipt.closest("form")?.method).toBe("post");
  expect(receipt.closest("form")?.getAttribute("action")).toBe("/api/self/billing/receipt/payment");
});

it("retains a member notice and offers a status check after an interrupted mark-read request", async () => {
  state.markSelf.mockRejectedValue(new Error("offline"));
  render(await SelfInboxPage({ audience: "member" }));
  const unread = screen.getByRole("region", { name: "Unread announcements" });
  fireEvent.click(within(unread).getByRole("button", { name: "Mark Morning lane changes as read" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm/i);
  expect(within(unread).getByRole("heading", { name: "Morning lane changes" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Check announcements" }).getAttribute("href")).toBe("/member/announcements");
  expect(state.markSelf).toHaveBeenCalledWith("member", expect.any(FormData));
});

it.each([["coach", "coach", "Coach Today"], ["reception", "receptionist", "Reception Today"]] as const)(
  "returns %s to its own workday and separates an unavailable inbox from an empty one",
  async (surface, roleKey, label) => {
    state.role = roleKey;
    state.staffRead.mockRejectedValue(new Error("temporary"));
    render(await StaffInboxPage({ surface }));
    expect(screen.getByRole("link", { name: label }).getAttribute("href")).toBe("/" + surface);
    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    expect(screen.getByRole("link", { name: "Retry announcements" }).getAttribute("href")).toBe("/" + surface + "/announcements");
    expect(screen.queryByText(/nothing yet/i)).toBeNull();
  },
);

it("moves a confirmed staff read into history even if the subsequent refresh fails", async () => {
  state.markStaff.mockResolvedValue({ ok: true });
  render(<NotificationInbox initial={[notice, earlier]} workday />);
  const unread = screen.getByRole("region", { name: "Unread announcements" });
  state.refresh.mockRejectedValue(new Error("refresh failed"));
  await act(async () => fireEvent.click(within(unread).getByRole("button", { name: "Mark Morning lane changes as read" })));
  expect(within(screen.getByRole("region", { name: "Previously read" })).getByRole("heading", { name: "Morning lane changes" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/refresh/i);
});

it("audit priority keeps a Family notice visible when mark-read loses its response", async () => {
  state.markSelf.mockRejectedValue(new Error("interrupted connection"));
  render(await SelfInboxPage({ audience: "guardian" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark Morning lane changes as read" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm/i);
  expect(screen.getByRole("heading", { name: "Morning lane changes" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Check announcements" }).getAttribute("href")).toBe("/family/announcements");
  expect(state.markSelf).toHaveBeenCalledWith("guardian", expect.any(FormData));
});
