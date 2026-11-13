import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ ctx: vi.fn(), create: vi.fn(), code: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("@/lib/auth/context", async (original) => ({ ...(await original<typeof import("@/lib/auth/context")>()), requireDefaultCtx: mock.ctx }));
vi.mock("@/lib/services/register", async (original) => ({ ...(await original<typeof import("@/lib/services/register")>()), createMember: mock.create }));
vi.mock("@/lib/services/people", async (original) => ({ ...(await original<typeof import("@/lib/services/people")>()), nextMemberCode: mock.code }));
import { createMemberAction } from "@/lib/actions/people";

const input = { fullName: "Synthetic adult", dateOfBirth: "1990-01-01", locationId: "00000000-0000-4000-8000-000000000001", consents: [{ purpose: "processing" as const, policyVersion: "2026.1", evidence: { channel: "test" } }] };
beforeEach(() => {
  vi.clearAllMocks();
  mock.ctx.mockResolvedValue({ tenantId: "00000000-0000-4000-8000-000000000002", userId: "00000000-0000-4000-8000-000000000003", permissions: new Set(["members.write"]), features: new Set() });
  mock.code.mockResolvedValue("SYN-1");
});

it.each(["owner", "receptionist"])("invalidates member directories after confirmed %s creation", async (role) => {
  mock.ctx.mockResolvedValueOnce({ tenantId: "00000000-0000-4000-8000-000000000002", userId: "00000000-0000-4000-8000-000000000003", roleKey: role, permissions: new Set(["members.write"]), features: new Set() });
  mock.create.mockResolvedValueOnce({ ok: true, memberId: "00000000-0000-4000-8000-000000000004" });
  expect((await createMemberAction(input)).ok).toBe(true);
  expect(mock.revalidate).toHaveBeenCalledWith("/owner/members");
  expect(mock.revalidate).toHaveBeenCalledWith("/reception/members");
  expect(mock.revalidate).toHaveBeenCalledWith("/owner");
  expect(mock.revalidate).toHaveBeenCalledWith("/reception");
});

it("does not invalidate for invalid input, refused creation or unknown failure", async () => {
  await expect(createMemberAction({ ...input, fullName: "" })).rejects.toThrow();
  expect(mock.revalidate).not.toHaveBeenCalled();
  mock.create.mockResolvedValueOnce({ ok: false, error: "Denied" });
  expect((await createMemberAction(input)).ok).toBe(false);
  expect(mock.revalidate).not.toHaveBeenCalled();
  mock.create.mockRejectedValueOnce(new Error("unknown write result"));
  await expect(createMemberAction(input)).rejects.toThrow("unknown write result");
  expect(mock.revalidate).not.toHaveBeenCalled();
});

it("returns the committed member once even if a cache invalidation fails", async () => {
  const memberId = "00000000-0000-4000-8000-000000000004";
  mock.create.mockResolvedValueOnce({ ok: true, memberId });
  mock.revalidate.mockImplementationOnce(() => { throw new Error("cache unavailable"); });
  await expect(createMemberAction(input)).resolves.toEqual({ ok: true, memberId });
  expect(mock.create).toHaveBeenCalledTimes(1);
  expect(mock.revalidate).toHaveBeenCalledWith("/owner/members");
  expect(mock.revalidate).toHaveBeenCalledWith("/reception/members");
  expect(mock.revalidate).toHaveBeenCalledWith("/owner");
  expect(mock.revalidate).toHaveBeenCalledWith("/reception");
});
