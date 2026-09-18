import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { locations } from "@/db/schema/locations";
import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";

// K-01 — shared shapes for the menu services. Split out of
// lib/services/menu.ts (which re-exports the public surface) to keep
// every file under the 300-line rule; no behaviour lives here beyond
// validation and the two small lookups both halves use.

export type MenuCategoryRow = {
  id: string;
  locationId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuItemRow = {
  id: string;
  locationId: string;
  categoryId: string;
  name: string;
  pricePaise: number;
  taxRateBp: number;
  sacCode: string;
  isVeg: boolean;
  isActive: boolean;
};

export type MenuMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export const uuid = z.string().uuid();
export const nameSchema = z.string().trim().min(1).max(120);
export const sacSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, "The SAC code must be 4-8 digits.");
export const priceSchema = z.number().int().positive().max(10_000_000_000);
export const taxRateSchema = z.number().int().min(0).max(10000);

export const categoryInput = z.object({
  locationId: uuid,
  name: nameSchema,
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

export const updateCategoryInput = z.object({
  categoryId: uuid,
  name: nameSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

export const itemInput = z.object({
  categoryId: uuid,
  name: nameSchema,
  pricePaise: priceSchema,
  taxRateBp: taxRateSchema,
  sacCode: sacSchema,
  isVeg: z.boolean().optional(),
});

export const updateItemInput = z.object({
  itemId: uuid,
  name: nameSchema.optional(),
  pricePaise: priceSchema.optional(),
  taxRateBp: taxRateSchema.optional(),
  sacCode: sacSchema.optional(),
  isVeg: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const listInput = z.object({
  locationId: uuid.optional(),
  categoryId: uuid.optional(),
});

export type ListMenuInput = z.input<typeof listInput>;

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid menu input.";
}

export async function locationExists(
  tx: TenantTx,
  tenantId: TenantId,
  locationId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.id, locationId),
        eq(locations.tenantId, tenantId),
        isNull(locations.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export function isUniqueViolation(err: unknown): boolean {
  let code: string | undefined = (err as { code?: string }).code;
  let cursor: unknown = err;
  while (!code && cursor && typeof cursor === "object" && "cause" in cursor) {
    cursor = (cursor as { cause: unknown }).cause;
    code = (cursor as { code?: string } | null)?.code;
  }
  return code === "23505";
}
