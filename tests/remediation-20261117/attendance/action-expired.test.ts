import { expect, it, vi } from "vitest";
vi.mock("@/lib/auth/context", () => {
  class NotFoundError extends Error {}
  return { NotFoundError, requireDefaultCtx: async () => { throw new NotFoundError(); } };
});
vi.mock("@/lib/auth/permission", () => ({ requirePermission: vi.fn(), ForbiddenError: class extends Error {} }));
vi.mock("@/lib/services/attendance-mark", () => ({ AttendanceReviewRequired: class extends Error {}, liveAttendanceAuthority: vi.fn() }));
vi.mock("@/lib/services/register", () => ({ markAttendance: vi.fn(), sessionVisibleToCaller: vi.fn() }));
vi.mock("@/lib/events/emit", () => ({ emitActivityEvents: vi.fn() }));
it("returns reauth, not a transient retry, for an expired authenticated context", async () => {
  const { markAttendanceSessionAction } = await import("@/lib/actions/coach");
  const result = await markAttendanceSessionAction({ sessionId: "00000000-0000-4000-8000-000000000003", memberId: "00000000-0000-4000-8000-000000000004", status: "present", clientId: "00000000-0000-4000-8000-000000000005", offlineScope: "a".repeat(64) });
  expect(result).toMatchObject({ ok: false, code: "reauth" });
});
