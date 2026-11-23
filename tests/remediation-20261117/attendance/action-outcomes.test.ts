import { expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ tenantId: asTenantId("00000000-0000-4000-8000-000000000001"), userId: asUserId("00000000-0000-4000-8000-000000000002"), roleKey: "coach" }), NotFoundError: class extends Error {} }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/offline/server-session", () => ({ offlineSessionState: async () => ({ authenticated: true, identity: { scope: "b".repeat(64), expiresAt: Date.now() + 60000 } }) }));
vi.mock("@/lib/services/register", () => ({ markAttendance: vi.fn(), sessionVisibleToCaller: async () => true }));
vi.mock("@/lib/events/emit", () => ({ emitActivityEvents: vi.fn() }));
it("classifies a changed offline session as reauthentication, never terminal", async () => {
  const { markAttendanceSessionAction } = await import("@/lib/actions/coach");
  const result = await markAttendanceSessionAction({ sessionId: "00000000-0000-4000-8000-000000000003", memberId: "00000000-0000-4000-8000-000000000004", status: "present", clientId: "00000000-0000-4000-8000-000000000005", offlineScope: "a".repeat(64) });
  expect(result).toMatchObject({ ok: false, code: "reauth" });
});
