import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { menuItems } from "@/db/schema/menu";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { listInput } from "@/lib/services/menu-core";
import type { ActionCtx } from "@/lib/auth/context";
import type { MenuItemRow } from "@/lib/services/menu-core";

// K-01 — menu item reads. Split from lib/services/menu-items.ts (the
// mutation half) to keep every file under the 300-line rule; re-exported
// through lib/services/menu.ts.

export async function listMenuItems(
  ctx: ActionCtx,
  raw: unknown = {},
): Promise<MenuItemRow[]> {
  const parsed = listInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (input.locationId && !locationVisible(access, input.locationId)) {
      return [];
    }
    const conditions = [
      eq(menuItems.tenantId, ctx.tenantId),
      isNull(menuItems.deletedAt),
    ];
    if (input.locationId) {
      conditions.push(eq(menuItems.locationId, input.locationId));
    } else {
      const predicate = locationPredicate(menuItems.locationId, access);
      if (predicate) conditions.push(predicate);
    }
    if (input.categoryId) {
      conditions.push(eq(menuItems.categoryId, input.categoryId));
    }

    const rows = await tx
      .select({
        id: menuItems.id,
        locationId: menuItems.locationId,
        categoryId: menuItems.categoryId,
        name: menuItems.name,
        pricePaise: menuItems.pricePaise,
        taxRateBp: menuItems.taxRateBp,
        sacCode: menuItems.sacCode,
        isVeg: menuItems.isVeg,
        isActive: menuItems.isActive,
      })
      .from(menuItems)
      .where(and(...conditions))
      .orderBy(asc(menuItems.name));

    return rows.map((row) => ({
      ...row,
      pricePaise: Number(row.pricePaise),
    }));
  });
}
