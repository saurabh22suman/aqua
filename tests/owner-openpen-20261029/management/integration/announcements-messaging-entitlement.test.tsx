// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Staging blocker F21 — "Default-provisioned owners are shown an announcement
// composer whose send action is not entitled".
//
// The chain (source-confirmed in the 29 Oct 2026 staging review):
//
//   db/seed-platform.ts      messaging is status "internal"; the default
//                             Standard plan grants GA features only, and the
//                             start-from-scratch preset omits messaging.
//   db/preset-definitions-r22.ts  START_FROM_SCRATCH has no "messaging".
//   lib/auth/permission.ts    requirePermission(ctx, "messaging.send") checks
//                             the role grant AND the tenant's feature set.
//   app/(owner)/owner/announcements/page.tsx
//                             gated the composer on hasPermission() alone, so
//                             an owner saw a composer whose action was refused.
//   components/announcements/announcement-composer.tsx
//                             the refusal surfaced as "Could not confirm the
//                             announcement" — an uncertainty message for what
//                             is actually an entitlement refusal.
//
// RED design — the page's ctx is the real shape (role grant set + feature
// set). Nothing here reads the source: each case asserts what the owner can
// and cannot do.
//
// No entitlement is created by this test and none is requested: `messaging`
// stays an internal feature and no transport is enabled.

const ctxState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  features: new Set<string>(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    roleKey: "owner",
    permissions: ctxState.permissions,
    features: ctxState.features,
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

const listAnnouncementsAction = vi.hoisted(() => vi.fn());
const listMyNotificationsAction = vi.hoisted(() => vi.fn());
const sendAnnouncementAction = vi.hoisted(() => vi.fn());
const listBatchesAction = vi.hoisted(() => vi.fn());
const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/announcements", () => ({
  listAnnouncementsAction: (...args: unknown[]) => listAnnouncementsAction(...args),
  listMyNotificationsAction: (...args: unknown[]) => listMyNotificationsAction(...args),
  sendAnnouncementAction: (...args: unknown[]) => sendAnnouncementAction(...args),
  markNotificationReadAction: vi.fn(),
}));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: (...args: unknown[]) => listBatchesAction(...args),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => routerRefresh(), push: vi.fn() }),
}));

import AnnouncementsPage from "@/app/(owner)/owner/announcements/page";
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";

const TITLE = "Pool closed on Saturday";
const BODY = "The pool is closed for maintenance on Saturday.";

beforeEach(() => {
  ctxState.permissions = new Set(["messaging.send"]);
  ctxState.features = new Set<string>();
  listAnnouncementsAction.mockResolvedValue([]);
  listMyNotificationsAction.mockResolvedValue([]);
  listBatchesAction.mockResolvedValue([]);
  sendAnnouncementAction.mockReset();
  routerRefresh.mockReset();
});

afterEach(() => {
  cleanup();
  listAnnouncementsAction.mockReset();
  listMyNotificationsAction.mockReset();
  listBatchesAction.mockReset();
  routerRefresh.mockReset();
});

describe("F21 · announcements eligibility follows the tenant's messaging feature", () => {
  it("does not offer the composer to an owner whose tenant has no messaging feature", async () => {
    ctxState.permissions = new Set(["messaging.send"]);
    ctxState.features = new Set([]);

    render(await AnnouncementsPage());

    expect(
      screen.queryByRole("button", { name: /send announcement/i }),
    ).toBeNull();
    expect(screen.getByTestId("announcements-unavailable").textContent ?? "").toMatch(
      /messaging isn't enabled/i,
    );
  });

  it("does no announcement work for a caller who may not send", async () => {
    ctxState.permissions = new Set(["messaging.send"]);
    ctxState.features = new Set([]);

    render(await AnnouncementsPage());

    expect(listBatchesAction).not.toHaveBeenCalled();
  });

  it("keeps the composer for an academy that has messaging enabled", async () => {
    ctxState.permissions = new Set(["messaging.send"]);
    ctxState.features = new Set(["messaging"]);

    render(await AnnouncementsPage());

    expect(screen.getByRole("button", { name: /send announcement/i })).toBeTruthy();
    expect(screen.queryByTestId("announcements-unavailable")).toBeNull();
    expect(listBatchesAction).toHaveBeenCalled();
  });

  it("still shows the sent history and the personal inbox to an ineligible owner", async () => {
    ctxState.permissions = new Set(["messaging.send"]);
    ctxState.features = new Set([]);
    listAnnouncementsAction.mockResolvedValue([
      {
        id: "a1",
        title: "Pool closed on Saturday",
        body: "Maintenance.",
        audience: "all",
        batchId: null,
        batchName: null,
        sentAt: "2026-10-25T04:30:00.000Z",
        recipientCount: 12,
      },
    ]);

    render(await AnnouncementsPage());

    expect(screen.getByText("Pool closed on Saturday")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /your notifications/i }),
    ).toBeTruthy();
  });
});

describe("F21 · a send whose outcome is unknown is reported honestly", () => {
  // Coordinator review (29 Oct 2026) of this stage: a catch CANNOT prove
  // non-delivery. The action may have committed before the response was
  // lost, so the only truthful statement about a thrown error is that
  // the outcome is unknown. The stage-1 case below asserted "not sent";
  // that assertion encoded a contract the review rejected and is
  // corrected here — it is a review-driven correction, not a
  // re-interpretation of an earlier RED.
  it("does not claim non-delivery when the action's response is lost", async () => {
    // The server may have committed the announcement before the response
    // was lost on the way back.
    sendAnnouncementAction.mockRejectedValue(
      new Error("network error: the response was lost"),
    );

    render(
      <AnnouncementComposer
        batches={[]}
        memberLabel="Members"
        batchLabel="Batch"
        guardianLabel="Guardians"
      />,
    );

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: TITLE },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: BODY },
    });
    fireEvent.click(screen.getByRole("button", { name: /send announcement/i }));

    await waitFor(() => {
      const status = screen.getByRole("status").textContent ?? "";
      // The outcome is unknown, and the message says exactly that.
      expect(status).toMatch(/could not be confirmed/i);
      // It must NOT claim that nothing was sent: the catch cannot know.
      expect(status).not.toMatch(/was not sent/i);
      expect(status).not.toMatch(/nothing was sent/i);
      // It must not claim a committed success either.
      expect(status).not.toMatch(/sent in-app to/i);
      // The safe next step: read the sent history before retrying.
      expect(status).toMatch(/refresh the sent list/i);
      // And it must not echo the announcement back to the screen.
      expect(status).not.toContain(TITLE);
      expect(status).not.toContain(BODY);
    });

    // No automatic retry and no second announcement.
    expect(sendAnnouncementAction).toHaveBeenCalledTimes(1);
  });

  it("keeps a known success when the page refresh fails after the send", async () => {
    sendAnnouncementAction.mockResolvedValue({
      ok: true,
      recipientCount: 12,
      whatsappRecipientCount: 3,
    });
    routerRefresh.mockImplementation(() => {
      throw new Error("router refresh failed");
    });

    render(
      <AnnouncementComposer
        batches={[]}
        memberLabel="Members"
        batchLabel="Batch"
        guardianLabel="Guardians"
      />,
    );

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: TITLE },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: BODY },
    });
    fireEvent.click(screen.getByRole("button", { name: /send announcement/i }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent ?? "").toMatch(
        /sent in-app to 12 accounts/i,
      ),
    );
    // The refresh failure must not rewrite an outcome the server already
    // reported.
    expect(screen.getByRole("status").textContent ?? "").not.toMatch(
      /could not be confirmed/i,
    );
  });

  it("shows the server's structured refusal, which does prove non-delivery", async () => {
    // The action returns ok:false only when it refused before any write,
    // so that refusal is a proven outcome and may be stated plainly.
    sendAnnouncementAction.mockResolvedValue({
      ok: false,
      error: "Invalid announcement.",
    });

    render(
      <AnnouncementComposer
        batches={[]}
        memberLabel="Members"
        batchLabel="Batch"
        guardianLabel="Guardians"
      />,
    );

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: TITLE },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: BODY },
    });
    fireEvent.click(screen.getByRole("button", { name: /send announcement/i }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent ?? "").toBe(
        "Invalid announcement.",
      ),
    );
  });

  it("reports the success it was given", async () => {
    sendAnnouncementAction.mockResolvedValue({
      ok: true,
      recipientCount: 12,
      whatsappRecipientCount: 3,
    });

    render(
      <AnnouncementComposer
        batches={[]}
        memberLabel="Members"
        batchLabel="Batch"
        guardianLabel="Guardians"
      />,
    );

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: TITLE },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: BODY },
    });
    fireEvent.click(screen.getByRole("button", { name: /send announcement/i }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent ?? "").toMatch(
        /sent in-app to 12 accounts/i,
      ),
    );
    expect(routerRefresh).toHaveBeenCalled();
  });
});
