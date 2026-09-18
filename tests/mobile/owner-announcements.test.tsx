// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-06 — the composer is in-app only (no WhatsApp send anywhere) and
// the inbox renders read state with a mark-read control.

const sendAnnouncementAction = vi.fn();
const listMyNotificationsAction = vi.fn();
const markNotificationReadAction = vi.fn();
vi.mock("@/lib/actions/announcements", () => ({
  sendAnnouncementAction: (...args: unknown[]) => sendAnnouncementAction(...args),
  listMyNotificationsAction: (...args: unknown[]) =>
    listMyNotificationsAction(...args),
  markNotificationReadAction: (...args: unknown[]) =>
    markNotificationReadAction(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { NotificationInbox } from "@/components/announcements/notification-inbox";
import type { NotificationRow } from "@/lib/services/announcements";

const BATCHES = [
  { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Junior 7am" },
];

const ROWS: NotificationRow[] = [
  {
    id: "n1",
    title: "Pool closed Saturday",
    body: "Maintenance.",
    announcementId: "a1",
    readAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: "n2",
    title: "Fee reminder",
    body: "Due on the 30th.",
    announcementId: "a2",
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
];

afterEach(() => {
  cleanup();
  sendAnnouncementAction.mockReset();
  listMyNotificationsAction.mockReset();
  markNotificationReadAction.mockReset();
});

describe("U-06 announcement composer", () => {
  it("states it is in-app only and offers the three audiences", () => {
    render(
      <AnnouncementComposer
        batches={BATCHES}
        memberLabel="Members"
        batchLabel="Batch"
        guardianLabel="Guardians"
      />,
    );
    expect(document.body.textContent).toMatch(/whatsapp is not connected/i);
    expect(document.body.textContent).toMatch(/in-app/i);
    const options = Array.from(document.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(options.join(" ")).toMatch(/everyone/i);
    expect(options.join(" ")).toMatch(/batch/i);
    expect(options.join(" ")).toMatch(/parents/i);
    // No batch picker until the batch audience is chosen.
    expect(document.body.textContent).not.toMatch(/Junior 7am/);
    fireEvent.change(document.querySelector("select")!, {
      target: { value: "batch" },
    });
    expect(document.body.textContent).toMatch(/Junior 7am/);
  });
});

describe("U-06 notification inbox", () => {
  it("renders unread and read rows with the right control", () => {
    listMyNotificationsAction.mockResolvedValue(ROWS);
    render(<NotificationInbox initial={ROWS} />);
    expect(document.body.textContent).toContain("1 unread");
    expect(document.body.textContent).toContain("Mark read");
    expect(document.body.textContent).toContain("Read");
  });

  it("marks a notification read through the action", async () => {
    listMyNotificationsAction.mockResolvedValue(ROWS);
    markNotificationReadAction.mockResolvedValue({ ok: true });
    render(<NotificationInbox initial={ROWS} />);
    fireEvent.click(
      Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Mark read",
      )!,
    );
    await waitFor(() =>
      expect(markNotificationReadAction).toHaveBeenCalledWith("n1"),
    );
  });
});
