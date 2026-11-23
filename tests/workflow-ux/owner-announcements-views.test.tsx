// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner audit simplification — Announcements is one task with two real
// destinations:
//
//   * Publish  (/owner/announcements) — compose + sent history + targeting.
//   * Your inbox (/owner/inbox)       — the caller's own notices and topics.
//
// The shared heading groups the two with native links and marks the active
// view with aria-current. The Publish entry follows the caller's active
// messaging feature/permission, so a tenant without messaging still opens
// its own inbox. The legacy Publish URL stays reachable with an honest
// "messaging is unavailable" state plus the sent history it still has.
//
// The private inbox must exist in exactly one place: /owner/inbox.

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  features: new Set<string>(),
  history: vi.fn(async () => [] as Array<Record<string, unknown>>),
  notifications: vi.fn(async () => [] as Array<Record<string, unknown>>),
  publishInboxRead: vi.fn(async () => [] as Array<Record<string, unknown>>),
  batches: vi.fn(async () => [] as Array<{ id: string; name: string }>),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: state.permissions,
    features: state.features,
  }),
  requirePagePermission: (_ctx: unknown, permission: string) => {
    if (!state.permissions.has(permission)) throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: state.permissions,
    features: state.features,
  }),
  NotFoundError: class NotFoundError extends Error {},
}));
vi.mock("@/lib/services/announcements", () => ({
  listMyNotifications: state.notifications,
}));
vi.mock("@/lib/actions/announcements", () => ({
  listAnnouncementsAction: state.history,
  listMyNotificationsAction: state.publishInboxRead,
}));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: state.batches,
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/components/announcements/announcement-composer", () => ({
  AnnouncementComposer: () => <div>Composer</div>,
}));
vi.mock("@/components/announcements/notification-inbox", () => ({
  NotificationInbox: () => <p>Personal notifications</p>,
}));

import AnnouncementsPage from "@/app/(owner)/owner/announcements/page";
import OwnerInboxPage from "@/app/(owner)/owner/inbox/page";

const SENT = [
  {
    id: "a1",
    title: "Pool closed Saturday",
    body: "Maintenance work.",
    audience: "all",
    batchId: null,
    batchName: null,
    sentAt: "2026-11-20T04:30:00.000Z",
    recipientCount: 3,
  },
];

function setAccess(permissions: string[], features: string[]) {
  state.permissions = new Set(permissions);
  state.features = new Set(features);
}

afterEach(() => {
  cleanup();
  state.history.mockReset();
  state.notifications.mockReset();
  state.publishInboxRead.mockReset();
  state.batches.mockReset();
  state.history.mockResolvedValue([]);
  state.notifications.mockResolvedValue([]);
  state.publishInboxRead.mockResolvedValue([]);
  state.batches.mockResolvedValue([]);
});

describe("owner Announcements grouping", () => {
  it("groups Publish and Your inbox and keeps the private inbox out of Publish", async () => {
    setAccess(
      ["messaging.send", "members.read", "programs.read", "settings.manage"],
      ["messaging"],
    );
    state.history.mockResolvedValue(SENT);

    render(await AnnouncementsPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Announcements" }),
    ).toBeTruthy();
    const views = screen.getByRole("navigation", { name: "Announcements views" });
    expect(
      within(views).getByRole("link", { name: "Publish" }).getAttribute("href"),
    ).toBe("/owner/announcements");
    expect(
      within(views)
        .getByRole("link", { name: "Publish" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(views).getByRole("link", { name: "Your inbox" }).getAttribute("href"),
    ).toBe("/owner/inbox");
    expect(
      within(views)
        .getByRole("link", { name: "Your inbox" })
        .getAttribute("aria-current"),
    ).toBeNull();

    expect(screen.getByText("Composer")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Sent history" })).toBeTruthy();
    expect(screen.getByTestId("announcement-state").textContent).toBe("Sent");
    expect(screen.queryByText("Personal notifications")).toBeNull();
    expect(state.publishInboxRead).not.toHaveBeenCalled();
  });

  it("offers Publish from the inbox only while messaging is active", async () => {
    setAccess(["messaging.send", "members.read"], ["messaging"]);
    state.notifications.mockResolvedValue([]);

    render(await OwnerInboxPage());

    const views = screen.getByRole("navigation", { name: "Announcements views" });
    expect(
      within(views).getByRole("link", { name: "Publish" }).getAttribute("href"),
    ).toBe("/owner/announcements");
    expect(
      within(views)
        .getByRole("link", { name: "Your inbox" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByText("Personal notifications")).toBeTruthy();
    expect(state.notifications).toHaveBeenCalledOnce();
  });

  it("keeps the inbox reachable for an inbox-only role in a tenant without messaging", async () => {
    setAccess(["members.read", "invoices.read", "reports.operational"], []);

    render(await OwnerInboxPage());

    const views = screen.getByRole("navigation", { name: "Announcements views" });
    expect(within(views).queryByRole("link", { name: "Publish" })).toBeNull();
    expect(
      within(views)
        .getByRole("link", { name: "Your inbox" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByText("Personal notifications")).toBeTruthy();
    expect(state.notifications).toHaveBeenCalledOnce();
  });

  it("keeps the legacy Publish URL honest when messaging is not active", async () => {
    setAccess(["messaging.send", "members.read", "programs.read"], []);
    state.history.mockResolvedValue(SENT);

    render(await AnnouncementsPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Announcements" }),
    ).toBeTruthy();
    const views = screen.getByRole("navigation", { name: "Announcements views" });
    expect(within(views).queryByRole("link", { name: "Publish" })).toBeNull();
    expect(
      within(views).getByRole("link", { name: "Your inbox" }).getAttribute("href"),
    ).toBe("/owner/inbox");

    expect(screen.getByTestId("announcements-unavailable").textContent).toMatch(
      /messaging isn't enabled/i,
    );
    expect(screen.getByTestId("announcements-unavailable").textContent).toMatch(
      /sent history is still below/i,
    );
    expect(screen.getByTestId("announcements-unavailable").textContent).not.toMatch(
      /notifications are still below/i,
    );
    expect(screen.queryByText("Composer")).toBeNull();
    expect(screen.getByRole("region", { name: "Sent history" })).toBeTruthy();
    expect(screen.queryByText("Personal notifications")).toBeNull();
  });

  it("still guards the legacy Publish URL for a role without messaging.send", async () => {
    setAccess(["members.read"], ["messaging"]);

    await expect(AnnouncementsPage()).rejects.toThrow("NOT_FOUND");
    expect(state.history).not.toHaveBeenCalled();
  });
});
