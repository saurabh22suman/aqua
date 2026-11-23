import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDefaultCtx: vi.fn(),
  requirePermission: vi.fn(),
  updateTenantProfile: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.requireDefaultCtx }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/services/tenant-profile", () => ({
  updateTenantProfile: mocks.updateTenantProfile,
  SUPPORTED_CURRENCY: "INR",
  UNSUPPORTED_CURRENCY_MESSAGE: "Only INR is supported",
}));
import { updateTenantProfileAction } from "@/lib/actions/tenant-profile";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireDefaultCtx.mockResolvedValue({ tenantId: "tenant", userId: "owner" });
  mocks.updateTenantProfile.mockResolvedValue({ kind: "ok" });
});

it("forwards a name and timezone update without inventing a GSTIN and still checks permissions", async () => {
  expect(await updateTenantProfileAction({ name: "Club", timezone: "Asia/Kolkata" })).toEqual({ kind: "ok" });
  expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "settings.manage");
  expect(mocks.updateTenantProfile).toHaveBeenCalledWith(expect.anything(), { name: "Club", timezone: "Asia/Kolkata" });
});

it("does not call the service when permission is denied", async () => {
  mocks.requirePermission.mockImplementation(() => { throw new Error("denied"); });
  await expect(updateTenantProfileAction({ name: "Club", timezone: "Asia/Kolkata" })).rejects.toThrow("denied");
  expect(mocks.updateTenantProfile).not.toHaveBeenCalled();
});
