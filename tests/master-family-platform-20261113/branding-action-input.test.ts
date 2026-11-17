import { expect, it, vi } from "vitest";
const update = vi.hoisted(() => vi.fn(async () => ({ kind: "ok" as const })));
const upload = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ tenantId: "tenant", userId: "owner" }) }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: () => undefined }));
vi.mock("@/lib/services/branding", () => ({ updateBranding: update, uploadBrandingAsset: upload, getBranding: vi.fn() }));
import * as actions from "@/lib/actions/branding";

it("rejects client-supplied asset references at the action boundary", async () => {
  const result = await actions.updateBrandingAction({ displayName: "Example", logo: { objectKey: "another-tenant/object" } });
  expect(result.kind).toBe("error");
  expect(update).not.toHaveBeenCalled();
});

it("passes selected image bytes to the authorized upload service", async () => {
  const form = new FormData();
  form.set("kind", "logo");
  form.set("file", new File(["synthetic"], "logo.png", { type: "image/png" }));
  const action = (actions as unknown as { uploadBrandingAssetAction?: (input: FormData) => Promise<{ ok: boolean }> }).uploadBrandingAssetAction;
  const result = action ? await action(form) : { ok: false };
  expect(result.ok).toBe(true);
  expect(upload).toHaveBeenCalledOnce();
});

it("rejects unsupported types and multiple files before reading bytes", async () => {
  const action = (actions as unknown as { uploadBrandingAssetAction: (input: FormData) => Promise<{ ok: boolean }> }).uploadBrandingAssetAction;
  const file = new File(["synthetic"], "bad.svg", { type: "image/svg+xml" });
  const read = vi.spyOn(file, "arrayBuffer");
  const form = new FormData();
  form.set("kind", "logo");
  form.set("file", file);
  expect((await action(form)).ok).toBe(false);
  expect(read).not.toHaveBeenCalled();
  const duplicate = new FormData();
  duplicate.set("kind", "logo");
  duplicate.append("file", new File(["one"], "a.png", { type: "image/png" }));
  duplicate.append("file", new File(["two"], "b.png", { type: "image/png" }));
  expect((await action(duplicate)).ok).toBe(false);
});
