import { expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";
const mocks = vi.hoisted(() => ({ mark: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({
  tenantId: asTenantId("00000000-0000-4000-8000-000000000001"), userId: asUserId("00000000-0000-4000-8000-000000000002"), roleKey: "coach" }), NotFoundError: class extends Error {} }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/offline/server-session", () => ({ offlineSessionState: mocks.state }));
vi.mock("@/lib/services/register", () => ({ markAttendance: mocks.mark, sessionVisibleToCaller: async () => true }));
vi.mock("@/lib/events/emit", () => ({ emitActivityEvents: vi.fn() }));

it("rejects replay from an old offline session before mutating or auditing attendance", async () => {
  mocks.state.mockResolvedValue({ authenticated: true, identity: { scope: "b".repeat(64), expiresAt: Date.now() + 60_000 } });
  const { markAttendanceSessionAction } = await import("@/lib/actions/coach");
  expect(await markAttendanceSessionAction({ sessionId: "00000000-0000-4000-8000-000000000003",
    memberId: "00000000-0000-4000-8000-000000000004", status: "present", clientId: "00000000-0000-4000-8000-000000000005", offlineScope: "a".repeat(64) }))
    .toMatchObject({ ok: false, error: expect.stringContaining("session changed") });
  expect(mocks.mark).not.toHaveBeenCalled();
});
