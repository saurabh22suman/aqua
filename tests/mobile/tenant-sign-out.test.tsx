// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TenantSignOut } from "@/components/tenant-sign-out";
const mocks = vi.hoisted(() => ({ logout: vi.fn(), sync: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/actions/tenant-auth", () => ({ logoutTenantAction: mocks.logout }));
vi.mock("@/lib/offline/logout", () => ({ syncBeforeLogout: mocks.sync }));
vi.mock("@/lib/offline/client-session", () => ({ clearOfflineData: mocks.clear,
  runOfflineLifecycle: (work: () => Promise<unknown>) => work() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("requires an explicit discard decision when syncing leaves pending marks", async () => {
  mocks.sync.mockResolvedValue(3);
  const view = render(<TenantSignOut />);
  fireEvent.click(view.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("3 attendance marks"));
  expect(mocks.logout).not.toHaveBeenCalled(); expect(mocks.clear).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Discard drafts and sign out" }));
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
  expect(mocks.clear.mock.invocationCallOrder[0]).toBeLessThan(mocks.logout.mock.invocationCallOrder[0]!);
});

it("does not sign out when private local data could not be cleared", async () => {
  mocks.sync.mockResolvedValue(0); mocks.clear.mockRejectedValue(new Error("Storage unavailable"));
  const view = render(<TenantSignOut />);
  fireEvent.click(view.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("local offline data must be cleared"));
  expect(mocks.logout).not.toHaveBeenCalled();
});
