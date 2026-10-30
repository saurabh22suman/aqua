// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Announcements keeps three distinct surfaces: "Compose an announcement"
// (60%), "Sent history" (40%) and the personal "Your notifications"
// full width below. Sent history states evidence it actually has —
// "Sent" with a time, or "Created" when no send time is recorded — and
// never invents delivery or read analytics.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["messaging.send"]),
    features: new Set(["messaging"]),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("@/lib/auth/permission", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/permission")>(
      "@/lib/auth/permission",
    );
  return {
    ...actual,
    hasPermission: (ctx: { permissions: Set<string> }, key: string) =>
      ctx.permissions.has(key),
  };
});

vi.mock("@/lib/actions/announcements", () => ({
  listAnnouncementsAction: async () => [
    {
      id: "ann-1",
      title: "Holiday opening hours",
      body: "We open at 8am next Monday.",
      audience: "all",
      batchName: null,
      recipientCount: 12,
      sentAt: "2026-10-25T04:00:00.000Z",
    },
    {
      id: "ann-2",
      title: "Training time change",
      body: "Coaches meet at 5pm.",
      audience: "all",
      batchName: null,
      recipientCount: 0,
      sentAt: null,
    },
  ],
  listMyNotificationsAction: async () => [],
  sendAnnouncementAction: async () => ({ ok: true, recipientCount: 0 }),
  markNotificationReadAction: async () => undefined,
}));

vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: async () => [{ id: "batch-1", name: "Morning Squad" }],
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

import AnnouncementsPage from "@/app/(owner)/owner/announcements/page";

afterEach(cleanup);

describe("owner announcements surfaces", () => {
  it("keeps compose, sent history and personal notifications as named surfaces", async () => {
    render(await AnnouncementsPage());

    expect(
      screen.getByRole("heading", { level: 2, name: "Compose an announcement" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Sent history" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Your notifications" }),
    ).toBeTruthy();
  });

  it("states sent evidence truthfully in the history", async () => {
    render(await AnnouncementsPage());

    const history = screen.getByRole("region", { name: "Sent history" });
    const states = within(history)
      .getAllByTestId("announcement-state")
      .map((node) => node.textContent);
    expect(states).toEqual(["Sent", "Created"]);
  });
});
