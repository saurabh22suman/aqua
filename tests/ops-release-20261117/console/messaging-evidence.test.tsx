// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const summary = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/platform-auth", () => ({ platformAuthStatusAction: async () => ({ kind: "authenticated", role: "admin" }) }));
vi.mock("@/lib/auth/ops-operation", () => ({ runOpsRead: async (_op: string, _id: string, read: () => Promise<unknown>) => read() }));
vi.mock("@/db/platform-tenants", () => ({ getTenantHeader: async () => ({ id: "a" }) }));
vi.mock("@/db/platform-tenant-messaging", () => ({ getTenantMessagingSummary: summary }));
import TenantMessagingPage from "@/app/(platform)/ops/tenants/[tenantId]/messaging/page";

afterEach(cleanup);
it("does not mistake an absent outbound attempt for a disconnected provider", async () => {
  summary.mockResolvedValue({ provider: null, lastSentAt: null, sentCount7d: 0, failedCount7d: 0 });
  render(await TenantMessagingPage({ params: Promise.resolve({ tenantId: "a" }) }));
  expect(screen.getByText(/no outbound attempts/i)).toBeDefined();
  expect(screen.queryByText(/not connected/i)).toBeNull();
  expect(screen.queryByText(/connection state for this tenant/i)).toBeNull();
});
it("labels a provider observed on a failed attempt without calling it connected", async () => {
  summary.mockResolvedValue({ provider: "cloud", lastSentAt: new Date("2026-11-17T00:00:00Z"), sentCount7d: 1, failedCount7d: 1 });
  render(await TenantMessagingPage({ params: Promise.resolve({ tenantId: "a" }) }));
  expect(screen.getByText(/last observed provider/i)).toBeDefined();
  expect(screen.getByText("WhatsApp Cloud API")).toBeDefined();
  expect(screen.queryByText(/connected.*means/i)).toBeNull();
});
