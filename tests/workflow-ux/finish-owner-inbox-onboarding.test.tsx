// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner finish lane — the two surfaces that were still delegating their
// whole workflow to a shared presenter:
//
//   * /owner/inbox had no owner page frame, no way back to Home and no
//     in-page recovery when the announcement read failed (the failure
//     became the route error boundary).
//   * /owner/onboarding told a half-configured academy that it was still
//     setting up its FIRST register, and gave no back path to Home.
//
// The tests pin the owner-facing outcome, not the presenter's internals.

const state = vi.hoisted(() => ({
  rows: vi.fn(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write", "dashboard.view"]),
    features: new Set(["members", "reports"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write"]),
    features: new Set(["members"]),
  }),
  NotFoundError: class NotFoundError extends Error {},
}));
vi.mock("@/lib/services/announcements", () => ({
  listMyNotifications: state.rows,
}));
vi.mock("@/components/announcements/notification-inbox", () => ({
  NotificationInbox: () => <p>Personal notifications</p>,
}));

import OwnerInboxPage from "@/app/(owner)/owner/inbox/page";
import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import type { OnboardingChecklist } from "@/lib/services/onboarding-checklist";

afterEach(() => {
  cleanup();
  state.rows.mockReset();
});

function item(key: "add_members" | "create_batch" | "assign_coach", complete: boolean) {
  return {
    key,
    title: `Step ${key}`,
    detail: `Why ${key} matters`,
    cta: { label: `Do ${key}`, href: `/owner/${key}` },
    complete,
  };
}

const PARTIAL: OnboardingChecklist = {
  items: [
    item("add_members", true),
    item("create_batch", false),
    item("assign_coach", false),
  ],
  completedCount: 1,
  totalCount: 3,
};

const ALL_DONE: OnboardingChecklist = {
  items: [
    item("add_members", true),
    item("create_batch", true),
    item("assign_coach", true),
  ],
  completedCount: 3,
  totalCount: 3,
};

describe("owner inbox workflow", () => {
  it("keeps the owner in the workspace with a back path when the read fails", async () => {
    state.rows.mockRejectedValue(new Error("temporary"));

    render(await OwnerInboxPage());

    expect(screen.getByRole("heading", { level: 1, name: "Announcements" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/owner");
    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/owner/inbox");
    expect(screen.queryByText(/nothing yet/i)).toBeNull();
  });

  it("renders the personal inbox inside the owner page frame", async () => {
    state.rows.mockResolvedValue([]);

    render(await OwnerInboxPage());

    expect(screen.getByText("Personal notifications")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/owner");
  });
});

describe("owner onboarding workflow", () => {
  it("describes a partly configured academy as finish, not first setup", () => {
    render(<OnboardingChecklistView data={PARTIAL} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Finish setting up your register" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/owner");
  });

  it("keeps the completed state and its existing copy", () => {
    render(<OnboardingChecklistView data={ALL_DONE} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Register setup complete" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Done")).toHaveLength(3);
  });
});
