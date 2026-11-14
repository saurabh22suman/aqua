// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ audience: vi.fn(), read: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/self-scope", () => ({ resolveSelfScope: state.audience }));
vi.mock("@/lib/services/announcements", () => ({ readSelfNotificationsInTx: state.read }));
vi.mock("@/lib/actions/self-notifications", () => ({ markSelfNotificationAction: vi.fn() }));
import { SelfInboxPage } from "@/components/announcements/self-inbox-page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each([["member", "/member"], ["guardian", "/family"]] as const)("returns %s inbox to its own home", async (audience, href) => {
  state.audience.mockResolvedValue({ read: async () => [] });
  render(await SelfInboxPage({ audience }));
  expect(state.audience).toHaveBeenCalledWith(audience, null);
  expect(screen.getByRole("link", { name: /back to (member|family) home/i }).getAttribute("href")).toBe(href);
  expect(screen.getByText(/nothing yet/i)).toBeTruthy();
});
it("denies before reading or showing a return link", async () => {
  state.audience.mockResolvedValue(null);
  await expect(SelfInboxPage({ audience: "guardian" })).rejects.toThrow("NOT_FOUND");
  expect(state.read).not.toHaveBeenCalled();
});
