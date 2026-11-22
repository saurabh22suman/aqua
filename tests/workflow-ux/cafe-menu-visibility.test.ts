import { expect, it, vi } from "vitest";
import { updateMenuItemAction } from "@/lib/actions/menu";

const update = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({ userId: "test-owner" }),
}));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/services/tax", () => ({ siteTaxRegistration: vi.fn() }));
vi.mock("@/lib/services/menu", () => ({ updateMenuItem: update }));

it.each([false, true])("persists an item visibility change to %s", async (isActive) => {
  const itemId = "50575dc7-530f-43fc-bf80-3ded17cabcd8";
  expect(await updateMenuItemAction({ itemId, isActive })).toEqual({ ok: true });
  expect(update).toHaveBeenLastCalledWith(expect.anything(), { itemId, isActive });
});
