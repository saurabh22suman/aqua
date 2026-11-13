import { expect, it } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";
import { callerIsLegacySystem } from "@/lib/services/resource-access";
import type { ActionCtx } from "@/lib/auth/context";

const tenantId = asTenantId("00000000-0000-4000-8000-000000000001");

it("does not treat missing identity or an incomplete human context as system authority", () => {
  expect(callerIsLegacySystem({ tenantId })).toBe(false);
  expect(callerIsLegacySystem({ tenantId, userId: asUserId("00000000-0000-4000-8000-000000000002") })).toBe(false);
});

it("recognizes only an explicitly marked identity-free system actor", () => {
  expect(callerIsLegacySystem({ tenantId, systemActor: true } as ActionCtx & { systemActor: true })).toBe(true);
  expect(callerIsLegacySystem({ tenantId, userId: asUserId("00000000-0000-4000-8000-000000000002"), systemActor: true } as ActionCtx & { systemActor: true })).toBe(false);
});
