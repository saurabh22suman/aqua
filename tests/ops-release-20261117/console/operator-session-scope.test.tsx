// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/platform-operators-write", () => ({ revokeAllOperatorSessionsAction: vi.fn(), revokeOperatorSessionAction: vi.fn(), setOperatorRoleAction: vi.fn(), setOperatorStatusAction: vi.fn() }));
import { OperatorList } from "@/app/(platform)/ops/operators/operator-list";

afterEach(cleanup);
const when = new Date("2026-11-17T00:00:00Z");
const account = { id: "admin", name: "Admin", email: "admin@example.test", role: "admin" as const, status: "active" as const, lastLoginAt: null, createdAt: when };
const session = (id: string) => ({ id, operatorId: "admin", state: "active" as const, secondFactorPassed: true, createdAt: when, lastSeenAt: when, expiresAt: when });
it("warns for only the verified current session and the revoke-all action", () => {
  const props = { actorId: "admin", currentSessionId: "current", operators: [account], sessions: [session("current"), session("other")], sessionCounts: { admin: 2 } };
  render(<OperatorList {...props} />);
  expect(screen.getAllByText(/this ends the session you are signed in with/i)).toHaveLength(2);
});
it("does not claim no sessions exist when the bounded slice omitted them", () => {
  render(<OperatorList actorId="admin" operators={[account]} sessions={[]} sessionCounts={{ admin: 2 }} />);
  expect(screen.queryByText(/has no session open/i)).toBeNull();
  expect(screen.getByText(/no sessions shown/i)).toBeDefined();
});
