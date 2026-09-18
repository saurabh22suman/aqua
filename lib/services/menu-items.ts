import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { menuCategories, menuItems } from "@/db/schema/menu";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  firstIssue,
  isUniqueViolation,
  itemInput,
  updateItemInput,
  uuid,
} from "@/lib/services/menu-core";
import type { ActionCtx } from "@/lib/auth/context";
import type { MenuMutationResult } from "@/lib/services/menu-core";

// K-01 — menu item mutations. See lib/services/menu.ts for the
// module's public surface; the read half is menu-item-list.ts, split
// out to keep every file under the 300-line rule.

function nameFilter(name: string) {
  return sql`lower(${menuItems.name}) = lower(${name})`;
}

export async function createMenuItem(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = itemInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const categoryRows = await tx
      .select()
      .from(menuCategories)
      .where(
        and(
          eq(menuCategories.id, input.categoryId),
          eq(menuCategories.tenantId, ctx.tenantId),
          isNull(menuCategories.deletedAt),
        ),
      )
      .limit(1);
    const category = categoryRows[0];
    if (!category || !locationVisible(access, category.locationId)) {
      return { ok: false, error: "Category not found." };
    }

    const dupe = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(
        and(
          eq(menuItems.tenantId, ctx.tenantId),
          eq(menuItems.locationId, category.locationId),
          isNull(menuItems.deletedAt),
          nameFilter(input.name),
        ),
      )
      .limit(1);
    if (dupe.length > 0) {
      return {
        ok: false,
        error: "An item with this name already exists at this location.",
      };
    }

    let created: { id: string } | undefined;
    try {
      [created] = await tx
        .insert(menuItems)
        .values({
          tenantId: ctx.tenantId,
          locationId: category.locationId,
          categoryId: category.id,
          name: input.name,
          pricePaise: BigInt(input.pricePaise),
          taxRateBp: input.taxRateBp,
          sacCode: input.sacCode,
          isVeg: input.isVeg ?? true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: menuItems.id });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error: "An item with this name already exists at this location.",
        };
      }
      throw err;
    }
    if (!created) return { ok: false, error: "The item could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "menu_item.create",
      entityType: "menu_item",
      entityId: created.id,
      after: {
        categoryId: category.id,
        locationId: category.locationId,
        name: input.name,
        pricePaise: input.pricePaise,
        taxRateBp: input.taxRateBp,
        sacCode: input.sacCode,
        isVeg: input.isVeg ?? true,
      },
    });
    return { ok: true, id: created.id };
  });
}

export async function updateMenuItem(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = updateItemInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.id, input.itemId),
          eq(menuItems.tenantId, ctx.tenantId),
          isNull(menuItems.deletedAt),
        ),
      )
      .for("update");
    const item = rows[0];
    if (!item || !locationVisible(access, item.locationId)) {
      return { ok: false, error: "Item not found." };
    }

    if (input.name !== undefined && input.name !== item.name) {
      const dupe = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.tenantId, ctx.tenantId),
            eq(menuItems.locationId, item.locationId),
            isNull(menuItems.deletedAt),
            nameFilter(input.name),
          ),
        )
        .limit(1);
      if (dupe.length > 0) {
        return {
          ok: false,
          error: "An item with this name already exists at this location.",
        };
      }
    }

    const changes: Partial<typeof menuItems.$inferInsert> = {
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    if (input.name !== undefined) changes.name = input.name;
    if (input.pricePaise !== undefined) changes.pricePaise = BigInt(input.pricePaise);
    if (input.taxRateBp !== undefined) changes.taxRateBp = input.taxRateBp;
    if (input.sacCode !== undefined) changes.sacCode = input.sacCode;
    if (input.isVeg !== undefined) changes.isVeg = input.isVeg;
    if (input.isActive !== undefined) changes.isActive = input.isActive;

    try {
      await tx
        .update(menuItems)
        .set(changes)
        .where(
          and(eq(menuItems.id, item.id), eq(menuItems.tenantId, ctx.tenantId)),
        );
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error: "An item with this name already exists at this location.",
        };
      }
      throw err;
    }

    const changedFields = Object.keys(changes).filter(
      (k) => k !== "updatedBy" && k !== "updatedAt",
    );
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "menu_item.update",
      entityType: "menu_item",
      entityId: item.id,
      before: {
        name: item.name,
        pricePaise: Number(item.pricePaise),
        taxRateBp: item.taxRateBp,
        sacCode: item.sacCode,
        isVeg: item.isVeg,
        isActive: item.isActive,
      },
      after: {
        name: changes.name ?? item.name,
        pricePaise:
          input.pricePaise !== undefined ? input.pricePaise : Number(item.pricePaise),
        taxRateBp: changes.taxRateBp ?? item.taxRateBp,
        sacCode: changes.sacCode ?? item.sacCode,
        isVeg: changes.isVeg ?? item.isVeg,
        isActive: changes.isActive ?? item.isActive,
      },
      changedFields,
    });
    return { ok: true, id: item.id };
  });
}

export async function archiveMenuItem(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = z.object({ itemId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.id, parsed.data.itemId),
          eq(menuItems.tenantId, ctx.tenantId),
          isNull(menuItems.deletedAt),
        ),
      )
      .for("update");
    const item = rows[0];
    if (!item || !locationVisible(access, item.locationId)) {
      return { ok: false, error: "Item not found." };
    }

    const now = new Date();
    await tx
      .update(menuItems)
      .set({ deletedAt: now, isActive: false, updatedBy: ctx.userId, updatedAt: now })
      .where(
        and(eq(menuItems.id, item.id), eq(menuItems.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "menu_item.archive",
      entityType: "menu_item",
      entityId: item.id,
      before: {
        name: item.name,
        pricePaise: Number(item.pricePaise),
        isActive: item.isActive,
      },
      after: { deletedAt: now.toISOString(), isActive: false },
    });
    return { ok: true, id: item.id };
  });
}
