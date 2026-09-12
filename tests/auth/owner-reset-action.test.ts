// @vitest-environment node
//
// Slice 11 — ops-issued owner reset action.
//
// Thin wrapper: parse -> platform-session check -> service. The
// service itself is covered by tests/auth/owner-reset-link.test.ts;
// this pins the action's guards and forwarding.

import { beforeEach, describe, expect, it, vi } from "vitest";

const platformAuthStatusAction = vi.fn();
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: (...args: unknown[]) => platformAuthStatusAction(...args),
}));

const issueOwnerResetLinkForPhone = vi.fn();
vi.mock("@/lib/services/invite-link", () => ({
  issueOwnerResetLinkForPhone: (...args: unknown[]) => issueOwnerResetLinkForPhone(...args),
}));

import { issueOwnerResetLinkAction } from "@/lib/actions/platform-login-link";

const TENANT_ID = "11111111-1111-7111-8111-111111111111";

describe("issueOwnerResetLinkAction", () => {
  beforeEach(() => {
    platformAuthStatusAction.mockReset();
    issueOwnerResetLinkForPhone.mockReset();
  });

  it("rejects malformed input without calling the service", async () => {
    const r = await issueOwnerResetLinkAction({ tenantId: "nope", phone: "" });
    expect(r.kind).toBe("error");
    expect(issueOwnerResetLinkForPhone).not.toHaveBeenCalled();
    expect(platformAuthStatusAction).not.toHaveBeenCalled();
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

  it("forwards tenant + phone to the service when authenticated", async () => {
    platformAuthStatusAction.mockResolvedValue({
      kind: "authenticated",
      userId: "u1",
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
    expect(issueOwnerResetLinkForPhone).toHaveBeenCalledTimes(1);
    expect(issueOwnerResetLinkForPhone.mock.calls[0]![0]).toBe(TENANT_ID);
    expect(issueOwnerResetLinkForPhone.mock.calls[0]![1]).toBe("+919000000001");
  });

  it("propagates the service error (e.g. not_owner) unchanged", async () => {
    platformAuthStatusAction.mockResolvedValue({
      kind: "authenticated",
      userId: "u1",
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
