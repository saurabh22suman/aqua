import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(async () => ({ tenantId: "tenant", userId: "owner" })),
  permission: vi.fn(),
  upload: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.context }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/services/branding", () => ({ uploadBrandingAsset: mocks.upload, updateBranding: vi.fn(), getBranding: vi.fn() }));
import { uploadBrandingAssetAction } from "@/lib/actions/branding";

beforeEach(() => vi.clearAllMocks());

it.each(["oversize", "missing", "duplicate-kind", "duplicate-file", "mime"])(
  "rejects %s before authorization or reading bytes",
  async (invalid) => {
    const form = new FormData();
    form.set("kind", "logo");
    const file = new File([new Uint8Array(invalid === "oversize" ? 750 * 1024 + 1 : 1)], "logo.png", { type: invalid === "mime" ? "image/svg+xml" : "image/png" });
    const read = vi.spyOn(file, "arrayBuffer");
    if (invalid !== "missing") form.set("file", file);
    if (invalid === "duplicate-kind") form.append("kind", "logo");
    if (invalid === "duplicate-file") form.append("file", file);
    expect(await uploadBrandingAssetAction(form)).toEqual({ ok: false });
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  },
);

it("does not read or upload a valid file when permission is denied", async () => {
  const form = new FormData();
  const file = new File(["image"], "logo.png", { type: "image/png" });
  const read = vi.spyOn(file, "arrayBuffer");
  form.set("kind", "logo");
  form.set("file", file);
  mocks.permission.mockImplementationOnce(() => { throw new Error("denied"); });
  await expect(uploadBrandingAssetAction(form)).rejects.toThrow("denied");
  expect(mocks.permission).toHaveBeenCalledWith(expect.anything(), "settings.manage");
  expect(read).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
