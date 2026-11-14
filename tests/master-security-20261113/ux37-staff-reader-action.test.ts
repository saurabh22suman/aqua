import { expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";

const mock = vi.hoisted(() => ({ ctx: vi.fn(), list: vi.fn(), mark: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mock.ctx }));
vi.mock("@/lib/services/announcements", () => ({ listMyNotifications: mock.list, markNotificationRead: mock.mark }));
import { listMyNotificationsAction, markNotificationReadAction } from "@/lib/actions/announcements";

it("allows a signed-in worker to read their own inbox without broadcast or member-directory grants", async () => {
  mock.ctx.mockResolvedValue({ tenantId: asTenantId("00000000-0000-4000-8000-000000000001"), userId: asUserId("00000000-0000-4000-8000-000000000002"), roleKey: "worker", permissions: new Set() });
  mock.list.mockResolvedValue([]);
  expect(await listMyNotificationsAction()).toEqual([]);
  expect(mock.list).toHaveBeenCalledOnce();
});

it("allows a worker to mark their own addressed notification read without a directory grant", async () => {
  mock.ctx.mockResolvedValue({ tenantId: asTenantId("00000000-0000-4000-8000-000000000001"), userId: asUserId("00000000-0000-4000-8000-000000000002"), roleKey: "worker", permissions: new Set() });
  mock.mark.mockResolvedValue({ ok: true });
  expect(await markNotificationReadAction("00000000-0000-4000-8000-000000000003")).toEqual({ ok: true });
});
