import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { menuCategories } from "@/db/schema/menu";
import { writeAudit } from "@/lib/audit/write";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  categoryInput,
  firstIssue,
  isUniqueViolation,
  listInput,
  locationExists,
  updateCategoryInput,
  uuid,
} from "@/lib/services/menu-core";
import type { ActionCtx } from "@/lib/auth/context";
import type {
  MenuCategoryRow,
  MenuItemRow,
  MenuMutationResult,
} from "@/lib/services/menu-core";

// K-01 — the menu catalog. Owner/admin manage; the service leaves the
// permission decision to the action layer (settings.read for reads,
// settings.manage for writes). Every mutation audits in the same
// transaction via writeAudit, carrying ctx.requestId.
//
// The item half lives in lib/services/menu-items.ts and is re-exported
// below so callers keep one import surface; the split keeps every file
// under the 300-line rule (same shape as reconciliation-closed-state).

export * from "./menu-items";
export * from "./menu-item-list";
export type { MenuCategoryRow, MenuItemRow, MenuMutationResult };

export async function createMenuCategory(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = categoryInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, input.locationId)) {
      return { ok: false, error: "Location not found." };
    }
    if (!(await locationExists(tx, ctx.tenantId, input.locationId))) {
      return { ok: false, error: "Location not found." };
    }

    let created: { id: string } | undefined;
    try {
      [created] = await tx
        .insert(menuCategories)
        .values({
          tenantId: ctx.tenantId,
          locationId: input.locationId,
          name: input.name,
          sortOrder: input.sortOrder ?? 0,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: menuCategories.id });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error: "A category with this name already exists at this location.",
        };
      }
      throw err;
    }
    if (!created) return { ok: false, error: "The category could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "menu_category.create",
      entityType: "menu_category",
      entityId: created.id,
      after: {
        locationId: input.locationId,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return { ok: true, id: created.id };
  });
}

export async function updateMenuCategory(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = updateCategoryInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select()
      .from(menuCategories)
      .where(
        and(
          eq(menuCategories.id, input.categoryId),
          eq(menuCategories.tenantId, ctx.tenantId),
          isNull(menuCategories.deletedAt),
        ),
      )
      .for("update");
    const category = rows[0];
    if (!category || !locationVisible(access, category.locationId)) {
      return { ok: false, error: "Category not found." };
    }

    const changes: Partial<typeof menuCategories.$inferInsert> = {
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    if (input.name !== undefined) changes.name = input.name;
    if (input.sortOrder !== undefined) changes.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) changes.isActive = input.isActive;

    try {
      await tx
        .update(menuCategories)
        .set(changes)
        .where(
          and(
            eq(menuCategories.id, input.categoryId),
            eq(menuCategories.tenantId, ctx.tenantId),
          ),
        );
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error: "A category with this name already exists at this location.",
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
      action: "menu_category.update",
      entityType: "menu_category",
      entityId: category.id,
      before: {
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      },
      after: {
        name: changes.name ?? category.name,
        sortOrder: changes.sortOrder ?? category.sortOrder,
        isActive: changes.isActive ?? category.isActive,
      },
      changedFields,
    });
    return { ok: true, id: category.id };
  });
}

export async function archiveMenuCategory(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = z.object({ categoryId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select()
      .from(menuCategories)
      .where(
        and(
          eq(menuCategories.id, parsed.data.categoryId),
          eq(menuCategories.tenantId, ctx.tenantId),
          isNull(menuCategories.deletedAt),
        ),
      )
      .for("update");
    const category = rows[0];
    if (!category || !locationVisible(access, category.locationId)) {
      return { ok: false, error: "Category not found." };
    }

    const now = new Date();
    await tx
      .update(menuCategories)
      .set({ deletedAt: now, isActive: false, updatedBy: ctx.userId, updatedAt: now })
      .where(
        and(
          eq(menuCategories.id, category.id),
          eq(menuCategories.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "menu_category.archive",
      entityType: "menu_category",
      entityId: category.id,
      before: { name: category.name, isActive: category.isActive },
      after: { deletedAt: now.toISOString(), isActive: false },
    });
    return { ok: true, id: category.id };
  });
}

export async function listMenuCategories(
  ctx: ActionCtx,
  raw: unknown = {},
): Promise<MenuCategoryRow[]> {
  const parsed = listInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (input.locationId && !locationVisible(access, input.locationId)) {
      return [];
    }
    const conditions = [
      eq(menuCategories.tenantId, ctx.tenantId),
      isNull(menuCategories.deletedAt),
    ];
    if (input.locationId) {
      conditions.push(eq(menuCategories.locationId, input.locationId));
    } else {
      const predicate = locationPredicate(menuCategories.locationId, access);
      if (predicate) conditions.push(predicate);
    }

    const rows = await tx
      .select({
        id: menuCategories.id,
        locationId: menuCategories.locationId,
        name: menuCategories.name,
        sortOrder: menuCategories.sortOrder,
        isActive: menuCategories.isActive,
      })
      .from(menuCategories)
      .where(and(...conditions))
      .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));

    return rows;
  });
}
