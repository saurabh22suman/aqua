import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";

const mocks = vi.hoisted(() => ({ ctx: vi.fn(), permission: vi.fn(), enrol: vi.fn(), tenant: vi.fn(), member: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.ctx }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: mocks.permission, ForbiddenError: class extends Error {} }));
vi.mock("@/lib/services/register", () => ({ enrolMember: mocks.enrol }));
vi.mock("@/db/tenant", () => ({ withTenant: mocks.tenant }));
vi.mock("@/lib/services/resource-access", () => ({ visibleMember: mocks.member }));
vi.mock("@/lib/services/parent-link", () => ({ signParentLinkToken: mocks.sign }));

const ctx = { tenantId: asTenantId("00000000-0000-4000-8000-000000000001"),
  userId: asUserId("00000000-0000-4000-8000-000000000002"), roleKey: "receptionist",
  allLocations: false, locationIds: ["00000000-0000-4000-8000-000000000003"], requestId: "00000000-0000-4000-8000-000000000004" };
const memberId = "00000000-0000-4000-8000-000000000005";
beforeEach(() => { vi.resetAllMocks(); mocks.ctx.mockResolvedValue(ctx); });

describe("review direct action boundaries", () => {
  it("passes the complete authenticated context through enrolment", async () => {
    const { enrolMemberAction } = await import("@/lib/actions/enrolment");
    const input = { memberId, batchId: "00000000-0000-4000-8000-000000000006" };
    mocks.enrol.mockResolvedValue({ ok: true });
    expect(await enrolMemberAction(input)).toEqual({ ok: true });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "members.write");
    expect(mocks.enrol).toHaveBeenCalledWith(ctx, input);
  });

  it("denies receptionist parent-link issuance before signing or querying", async () => {
    const { issueParentLinkAction } = await import("@/lib/actions/parent-link");
    expect(await issueParentLinkAction({ memberId })).toMatchObject({ kind: "error", code: "unauthorized" });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it("denies an owner's missing or forbidden member inside the audited transaction", async () => {
    mocks.ctx.mockResolvedValue({ ...ctx, roleKey: "owner" });
    mocks.tenant.mockImplementation(async (_id: string, fn: (tx: object) => Promise<unknown>) => fn({}));
    mocks.member.mockResolvedValue(null);
    const { issueParentLinkAction } = await import("@/lib/actions/parent-link");
    expect(await issueParentLinkAction({ memberId })).toMatchObject({ kind: "error", code: "unauthorized" });
    expect(mocks.member).toHaveBeenCalledWith({}, { ...ctx, roleKey: "owner" }, memberId);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
