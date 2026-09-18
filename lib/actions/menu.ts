"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  archiveMenuCategory,
  archiveMenuItem,
  createMenuCategory,
  createMenuItem,
  listMenuCategories,
  listMenuItems,
  updateMenuCategory,
  updateMenuItem,
  type MenuCategoryRow,
  type MenuItemRow,
  type MenuMutationResult,
} from "@/lib/services/menu";

// K-01 — menu actions. Reads ride settings.read (reception has it so
// the counter can render the menu), writes need settings.manage
// (owner/admin). Standing preamble: zod parse first, permission
// check next, service call last; ctx.requestId flows through to the
// audit rows.

const listInput = z.object({
  locationId: z.string().uuid().optional(),
});

const categoryInput = z.object({
  locationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const updateCategoryInput = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

const itemInput = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  pricePaise: z.number().int().positive().max(10_000_000_000),
  taxRateBp: z.number().int().min(0).max(10000),
  sacCode: z.string().trim().regex(/^\d{4,8}$/, "The SAC code must be 4-8 digits."),
  isVeg: z.boolean().optional(),
});

const updateItemInput = itemInput
  .omit({ categoryId: true })
  .partial()
  .extend({ itemId: z.string().uuid() });

const archiveInput = z.object({
  categoryId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
});

export type MenuView = {
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
};

export async function listMenuAction(raw: unknown): Promise<MenuView> {
  const parsed = listInput.safeParse(raw);
  if (!parsed.success) return { categories: [], items: [] };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  const [categories, items] = await Promise.all([
    listMenuCategories(ctx, parsed.data),
    listMenuItems(ctx, parsed.data),
  ]);
  return { categories, items };
}

export async function createMenuCategoryAction(
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = categoryInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return createMenuCategory(ctx, parsed.data);
}

export async function updateMenuCategoryAction(
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = updateCategoryInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updateMenuCategory(ctx, parsed.data);
}

export async function archiveMenuCategoryAction(
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = archiveInput.safeParse(raw);
  if (!parsed.success || !parsed.data.categoryId) {
    return { ok: false, error: "Invalid category." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return archiveMenuCategory(ctx, { categoryId: parsed.data.categoryId });
}

export async function createMenuItemAction(
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = itemInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid item." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return createMenuItem(ctx, parsed.data);
}

export async function updateMenuItemAction(
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = updateItemInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid item." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updateMenuItem(ctx, parsed.data);
}

export async function archiveMenuItemAction(
  raw: unknown,
): Promise<MenuMutationResult> {
  const parsed = archiveInput.safeParse(raw);
  if (!parsed.success || !parsed.data.itemId) {
    return { ok: false, error: "Invalid item." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return archiveMenuItem(ctx, { itemId: parsed.data.itemId });
}
