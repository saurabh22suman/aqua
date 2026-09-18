import { describe, expect, it, vi } from "vitest";

// K-07 — café access guards.
//
// Two layers, both pinned here:
//   1. The owner menu page and the reception café page call their
//      surface guard first; a coach gets `notFound()` from either
//      (canAccessSurface: coach → coach surface only).
//   2. The real menu actions refuse a coach on both the read
//      (settings.read) and every write (settings.manage) — the
//      permission helper throws before any service call, so these
//      run without a database.

const COACH_CTX = vi.hoisted(() => ({
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000002",
  membershipId: "00000000-0000-0000-0000-000000000003",
  roleKey: "coach",
  roleId: "00000000-0000-0000-0000-000000000004",
  slug: "test",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set<string>([
    "attendance.read",
    "attendance.mark",
    "members.read.assigned",
    "programs.read",
    "levels.read",
    "levels.assess",
  ]),
  features: new Set<string>([
    "members",
    "attendance",
    "programs",
    "enquiries",
    "staff",
    "settings",
  ]),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => COACH_CTX,
}));

import OwnerMenuPage from "@/app/(owner)/owner/settings/menu/page";
import ReceptionCafePage from "@/app/(reception)/reception/cafe/page";
import {
  createMenuCategoryAction,
  createMenuItemAction,
  listMenuAction,
  updateMenuItemAction,
} from "@/lib/actions/menu";
import { ForbiddenError } from "@/lib/auth/permission";

const LOCATION = "11111111-1111-7111-8111-111111111111";
const CATEGORY = "22222222-2222-7222-8222-222222222222";
const ITEM = "33333333-3333-7333-8333-333333333333";

describe("café surfaces fail closed for a coach", () => {
  it("owner café menu page rejects with notFound before any data fetch", async () => {
    await expect(OwnerMenuPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("reception café page rejects with notFound for a coach", async () => {
    await expect(ReceptionCafePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("café menu actions refuse a coach", () => {
  it("cannot read the menu (settings.read)", async () => {
    await expect(listMenuAction({})).rejects.toThrow(ForbiddenError);
  });

  it("cannot create a category (settings.manage)", async () => {
    await expect(
      createMenuCategoryAction({ locationId: LOCATION, name: "Snacks" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("cannot create an item (settings.manage)", async () => {
    await expect(
      createMenuItemAction({
        categoryId: CATEGORY,
        name: "Masala chai",
        pricePaise: 25000,
        taxRateBp: 500,
        sacCode: "996331",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("cannot update an item (settings.manage)", async () => {
    await expect(
      updateMenuItemAction({ itemId: ITEM, isActive: false }),
    ).rejects.toThrow(ForbiddenError);
  });
});
