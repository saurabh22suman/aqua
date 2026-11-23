import { beforeEach, expect, it, vi } from "vitest";

const { resolveMembership, canSelect, workspace, jar } = vi.hoisted(() => {
  const workspace = { userId: "owner-a", tenantId: "business-a", roleKey: "owner", permissions: new Set(["dashboard.view"]), features: new Set(["reports"]) };
  const jar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  return { resolveMembership: vi.fn(), canSelect: vi.fn(), workspace, jar };
});

vi.mock("@/db/platform", () => ({ resolveDefaultMembership: resolveMembership }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: canSelect }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => workspace }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { ownerDefaultFacilityKey, ownerStartPath } from "@/lib/services/workspace-opening";
import { saveOwnerDefaultFacilityAction } from "@/lib/actions/owner-default-facility";

const facility = "28c7399a-cd95-4e97-a241-3ec79e9f16c0";
function fields(value: string) {
  const form = new FormData();
  form.set("facility", value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveMembership.mockResolvedValue(workspace);
  canSelect.mockResolvedValue(true);
  jar.get.mockReturnValue(undefined);
});

it("uses All when the business has no saved opening preference", async () => {
  expect(await ownerStartPath("/owner", "person", undefined, jar)).toBe("/owner?facility=all");
  expect(canSelect).not.toHaveBeenCalled();
});

it("opens the preferred facility only for a live and authorized business membership", async () => {
  jar.get.mockReturnValue({ value: facility });
  expect(await ownerStartPath("/owner", "person", "business-a", jar)).toBe(`/owner?facility=${facility}`);
  expect(resolveMembership).toHaveBeenCalledWith("person", "business-a");
  canSelect.mockResolvedValue(false);
  expect(await ownerStartPath("/owner", "person", "business-a", jar)).toBe("/owner?facility=all");
  resolveMembership.mockResolvedValue({ ...workspace, requiresSelection: true });
  expect(await ownerStartPath("/owner", "person", undefined, jar)).toBe("/owner?facility=all");
});

it("scopes the preference to the person and business and leaves other role destinations alone", async () => {
  expect(ownerDefaultFacilityKey(workspace)).not.toBe(ownerDefaultFacilityKey({ ...workspace, userId: "owner-b" }));
  expect(ownerDefaultFacilityKey(workspace)).not.toBe(ownerDefaultFacilityKey({ ...workspace, tenantId: "business-b" }));
  expect(await ownerStartPath("/coach", "person", undefined, jar)).toBe("/coach");
  expect(resolveMembership).not.toHaveBeenCalled();
});

it("rejects unavailable facilities and allows switching the default back to All", async () => {
  canSelect.mockResolvedValue(false);
  expect(await saveOwnerDefaultFacilityAction({}, fields(facility))).toMatchObject({ error: expect.any(String) });
  expect(jar.set).not.toHaveBeenCalled();
  expect(await saveOwnerDefaultFacilityAction({}, fields("all"))).toEqual({ saved: true });
  expect(jar.delete).toHaveBeenCalledWith(ownerDefaultFacilityKey(workspace));
});

it("saves the authorized preference without selecting a facility in the current session", async () => {
  expect(await saveOwnerDefaultFacilityAction({}, fields(facility))).toEqual({ saved: true });
  expect(jar.set).toHaveBeenCalledWith(ownerDefaultFacilityKey(workspace), facility, expect.objectContaining({ httpOnly: true }));
  expect(jar.set).toHaveBeenCalledTimes(1);
});
