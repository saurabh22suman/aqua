// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — the announcements hub.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
//   1. The composer was a pile of <div>s with a type="button" control:
//      pressing Enter in the title field did nothing, and the page had
//      no native form semantics for a screen reader or a keyboard.
//   2. The page put "Your notifications" between the composer and the
//      sent history, so the three surfaces read as one undifferentiated
//      list instead of compose / history / personal inbox.
//   3. Each history row showed a bare timestamp with no state word, so
//      "created" and "sent" could not be told apart at a glance.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    roleKey: "owner",
    permissions: new Set(["messaging.send"]),
    // The real Ctx always carries the tenant's feature set next to the
    // role grant, and the announcements page resolves the composer on
    // both (staging blocker F21). This fixture is completed, not
    // weakened: no assertion below changes.
    features: new Set(["messaging"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const listAnnouncementsAction = vi.fn();
const listMyNotificationsAction = vi.fn();
vi.mock("@/lib/actions/announcements", () => ({
  listAnnouncementsAction: (...args: unknown[]) => listAnnouncementsAction(...args),
  listMyNotificationsAction: (...args: unknown[]) => listMyNotificationsAction(...args),
  markNotificationReadAction: vi.fn(),
  sendAnnouncementAction: vi.fn(),
}));

vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: async () => [],
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import AnnouncementsPage from "@/app/(owner)/owner/announcements/page";

const ANNOUNCEMENTS = [
  {
    id: "a1",
    title: "Pool closed on Saturday",
    body: "The pool will be closed for maintenance on Saturday.",
    audience: "all",
    batchId: null,
    batchName: null,
    sentAt: "2026-10-25T04:30:00.000Z",
    recipientCount: 12,
  },
];

afterEach(() => {
  cleanup();
  listAnnouncementsAction.mockReset();
  listMyNotificationsAction.mockReset();
});

describe("announcement composer (C2)", () => {
  it("is a native form, so Enter in a field submits it", () => {
    render(
      <AnnouncementComposer
        batches={[]}
        memberLabel="Members"
        batchLabel="Batch"
        guardianLabel="Guardians"
      />,
    );

    const form = document.querySelector("form");
    expect(form, "the composer needs native form semantics").not.toBeNull();

    const send = screen.getByRole("button", { name: /send announcement/i });
    expect(send.getAttribute("type")).toBe("submit");
  });

  it("keeps the audience choice and the consent wording", () => {
    render(
      <AnnouncementComposer
        batches={[]}
        memberLabel="Members"
        batchLabel="Batch"
        guardianLabel="Guardians"
      />,
    );

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/queues WhatsApp updates/i);
    expect(text).toMatch(/communications consent/i);
  });
});

describe("announcements page (C2)", () => {
  it("keeps the sent history before the personal inbox", async () => {
    listAnnouncementsAction.mockResolvedValue(ANNOUNCEMENTS);
    listMyNotificationsAction.mockResolvedValue([]);

    render(await AnnouncementsPage());

    const headings = Array.from(document.querySelectorAll("h2")).map(
      (h) => h.textContent ?? "",
    );
    const sentIndex = headings.findIndex((h) => /sent/i.test(h));
    const inboxIndex = headings.findIndex((h) => /your notifications/i.test(h));

    expect(sentIndex).toBeGreaterThanOrEqual(0);
    expect(inboxIndex).toBeGreaterThanOrEqual(0);
    expect(sentIndex).toBeLessThan(inboxIndex);
  });

  it("states the state of each announcement instead of a bare timestamp", async () => {
    listAnnouncementsAction.mockResolvedValue(ANNOUNCEMENTS);
    listMyNotificationsAction.mockResolvedValue([]);

    render(await AnnouncementsPage());

    expect(screen.getByTestId("announcement-state").textContent).toBe("Sent");
  });
});
