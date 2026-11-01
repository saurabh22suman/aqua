import { expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn(async () => ({ tenantId: "tenant-a", userId: "user-a", permissions: new Set(), features: new Set() })));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: auth }));
import Page from "@/app/(owner)/owner/settings/appearance/page";
it("requires an owner-surface session without changing permissions or features", async () => {
  const page = await Page();
  const ctx = await auth.mock.results[0]!.value;
  expect(auth).toHaveBeenCalledTimes(1);
  expect(ctx.permissions.size).toBe(0);
  expect(ctx.features.size).toBe(0);
  expect(page).toBeTruthy();
});
