// @vitest-environment node
//
// Slice 11 — ops-issued owner reset action.
//
// Thin wrapper: parse -> admin session -> audited Ops pipeline -> service. The
// service itself is covered by tests/auth/owner-reset-link.test.ts;
// this pins the action's guards and forwarding.
//
// A REFUSAL is now an audited operation too: every Ops operation writes a
// boundary row, so a malformed input or a refused role leaves a trace
// instead of vanishing. The trace needs the ACTOR, so the session is read
// for the trace — that read is not an issuance and it never reaches the
// service.

import { beforeEach, describe, expect, it, vi } from "vitest";

const platformAuthStatusAction = vi.fn();
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: (...args: unknown[]) => platformAuthStatusAction(...args),
  // R03 — the mutating platform actions gate on the admin guard. It
  // delegates to the same mocked status so these tests keep pinning
  // the session/role boundary.
  requireOpsAdminAction: async (...args: unknown[]) => {
    const status = (await platformAuthStatusAction(...args)) as {
      kind: string;
      userId?: string;
      role?: string;
    };
    if (status.kind !== "authenticated") return { kind: "error", reason: "unauthenticated" };
    if (status.role !== "admin") return { kind: "error", reason: "forbidden" };
    return { kind: "ok", userId: status.userId, role: "admin" };
  },
}));

const opsAction = vi.fn(async (_input: unknown, run: () => Promise<unknown>) => run());
vi.mock("@/db/ops-action", () => ({
  opsAction: (input: unknown, run: () => Promise<unknown>) => opsAction(input, run),
}));
// The boundary writer is the audit sink for every Ops operation. It is
// mocked here so the refusal trace can be asserted WITHOUT a database.
// The double is TYPED, not implemented with an ignored rest argument:
// `vi.fn<(...args: unknown[]) => Promise<void>>` keeps the writer's call
// signature — so `mock.calls` stays an `unknown[]` the assertions below
// destructure — while the implementation itself names no parameter. A
// mock records the arguments it is called with either way, and an
// unused rest binding is a lint error (`eslint . --max-warnings=0`).
const appendOpsBoundaryEvent = vi.fn<(...args: unknown[]) => Promise<void>>(
  async (): Promise<void> => undefined,
);
vi.mock("@/db/ops-operation-writer", () => ({
  appendOpsBoundaryEvent: (...args: unknown[]) => appendOpsBoundaryEvent(...args),
}));
// This unit test checks forwarding. Real actor rechecks and transaction/audit
// rollback are covered by tests/ops-security/credential-audit.test.ts.
const issueOwnerResetLinkForPhone = vi.fn();
vi.mock("@/lib/services/invite-link", () => ({
  issueOwnerResetLinkForPhone: (...args: unknown[]) => issueOwnerResetLinkForPhone(...args),
}));

import { issueOwnerResetLinkAction } from "@/lib/actions/platform-login-link";

const OPS_ACTOR_ID = "22222222-2222-7222-8222-222222222222";
const TENANT_ID = "11111111-1111-7111-8111-111111111111";

describe("issueOwnerResetLinkAction", () => {
  beforeEach(() => {
    opsAction.mockClear();
    platformAuthStatusAction.mockReset();
    issueOwnerResetLinkForPhone.mockReset();
    appendOpsBoundaryEvent.mockClear();
  });

  it("rejects malformed input without calling the service, and traces the refusal", async () => {
    platformAuthStatusAction.mockResolvedValue({
      kind: "authenticated",
      userId: OPS_ACTOR_ID,
      role: "admin",
    });

    const r = await issueOwnerResetLinkAction({ tenantId: "nope", phone: "" });
    expect(r.kind).toBe("error");

    // No issuance: the service never ran and the audited mutation
    // pipeline never started.
    expect(issueOwnerResetLinkForPhone).not.toHaveBeenCalled();
    expect(opsAction).not.toHaveBeenCalled();

    // The refusal is NOT silent. The session was read ONCE — for the
    // actor of the refusal trace, not for a credential — and exactly ONE
    // boundary row was written, naming the operation and the outcome.
    expect(platformAuthStatusAction).toHaveBeenCalledTimes(1);
    expect(appendOpsBoundaryEvent).toHaveBeenCalledTimes(1);
    const [operation, outcome, actorId, correlationId, tenantId, origin] =
      appendOpsBoundaryEvent.mock.calls[0]!;
    expect(operation).toBe("tenant.owner_reset_link.issue");
    expect(outcome).toBe("invalid");
    expect(actorId).toBe(OPS_ACTOR_ID);
    expect(correlationId).toEqual(expect.any(String));
    // The MALFORMED tenant id never reaches the writer.
    expect(tenantId).toBeUndefined();
    expect(origin).toBe("server_action");
  });

  it("writes no trace for an anonymous caller with malformed input", async () => {
    platformAuthStatusAction.mockResolvedValue({ kind: "not_found" });

    const r = await issueOwnerResetLinkAction({ tenantId: "nope", phone: "" });
    expect(r.kind).toBe("error");
    expect(issueOwnerResetLinkForPhone).not.toHaveBeenCalled();
    expect(opsAction).not.toHaveBeenCalled();

    // An anonymous caller is not an Ops operation: no row, so an
    // unauthenticated caller cannot write to the audit log.
    expect(appendOpsBoundaryEvent).not.toHaveBeenCalled();
  });

  it("refuses when there is no authenticated platform session", async () => {
    platformAuthStatusAction.mockResolvedValue({ kind: "not_found" });
    const r = await issueOwnerResetLinkAction({
      tenantId: TENANT_ID,
      phone: "+919000000001",
    });
    expect(r.kind).toBe("error");
    expect(issueOwnerResetLinkForPhone).not.toHaveBeenCalled();
  });

  it("refuses viewers before the Ops pipeline or service", async () => {
    platformAuthStatusAction.mockResolvedValue({ kind: "authenticated", userId: OPS_ACTOR_ID, role: "viewer" });
    expect((await issueOwnerResetLinkAction({ tenantId: TENANT_ID, phone: "+919000000001" })).kind).toBe("error");
    expect(opsAction).not.toHaveBeenCalled();
    expect(issueOwnerResetLinkForPhone).not.toHaveBeenCalled();
  });

  it("forwards tenant + phone to the service when authenticated", async () => {
    platformAuthStatusAction.mockResolvedValue({
      kind: "authenticated",
      userId: OPS_ACTOR_ID,
      role: "admin",
    });
    issueOwnerResetLinkForPhone.mockResolvedValue({
      kind: "ok",
      token: "tok",
      urlPath: "/login/link/tok",
      purpose: "reset",
      expiresAt: new Date(),
      phone: "+919000000001",
      roleKey: "owner",
      tenantName: "Demo",
    });
    const r = await issueOwnerResetLinkAction({
      tenantId: TENANT_ID,
      phone: "+919000000001",
    });
    expect(r.kind).toBe("ok");
    expect(opsAction).toHaveBeenCalledWith(expect.objectContaining({
      actorId: OPS_ACTOR_ID, tenantId: TENANT_ID, scope: "tenant.owner_reset_link.issue",
    }), expect.any(Function));
    expect(issueOwnerResetLinkForPhone).toHaveBeenCalledTimes(1);
    expect(issueOwnerResetLinkForPhone.mock.calls[0]![0]).toBe(TENANT_ID);
    expect(issueOwnerResetLinkForPhone.mock.calls[0]![1]).toBe("+919000000001");
  });

  it("propagates the service error (e.g. not_owner) unchanged", async () => {
    platformAuthStatusAction.mockResolvedValue({
      kind: "authenticated",
      userId: OPS_ACTOR_ID,
      role: "admin",
    });
    issueOwnerResetLinkForPhone.mockResolvedValue({
      kind: "error",
      code: "not_owner",
      message: "Reset links are issued to owners only.",
    });
    const r = await issueOwnerResetLinkAction({
      tenantId: TENANT_ID,
      phone: "+919000000002",
    });
    expect(r).toMatchObject({ kind: "error", code: "not_owner" });
  });
});
