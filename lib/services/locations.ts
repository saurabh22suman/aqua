import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { locations, type LocationKind } from "@/db/schema/locations";
import { resolveConfig, setTenantConfigValue } from "@/db/config";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";

// U-07 — the owner's location editor and business-hours editor.
//
// Locations are the O-01 hierarchy's top node under the tenant
// (tenant → location → facility → sub-unit). The schema caps `kind`
// at club | cafe | mixed. Address is the free-form jsonb column the
// schema already carries; the editor writes the five fields below
// and leaves anything else untouched.
//
// Business hours live in the config registry under
// `operations.business_hours`, location scope. Reads resolve through
// the standard waterfall (platform default → tenant → location), so
// an unset tenant shows the honest empty default rather than
// invented hours.

export const BUSINESS_HOURS_KEY = "operations.business_hours" as const;

export const businessHoursDaySchema = z.object({
  day: z.enum([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]),
  closed: z.boolean(),
  open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const businessHoursSchema = z.object({
  days: z.array(businessHoursDaySchema).max(7),
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

export type LocationAdminRow = {
  id: string;
  name: string;
  kind: LocationKind;
  isPrimary: boolean;
  address: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
  } | null;
  createdAt: string;
};

export type LocationMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const addressSchema = z
  .object({
    line1: z.string().trim().max(160).optional(),
    line2: z.string().trim().max(160).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    pincode: z.string().trim().max(10).optional(),
  })
  .optional();

export const createLocationInput = z.object({
  name: z.string().trim().min(1, "Give the location a name.").max(120),
  kind: z.enum(["club", "cafe", "mixed"]),
  address: addressSchema,
});

export const updateLocationInput = z.object({
  locationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(["club", "cafe", "mixed"]).optional(),
  address: addressSchema,
});

export async function listAdminLocations(
  ctx: ActionCtx,
): Promise<LocationAdminRow[]> {
  return withTenant(ctx.tenantId, (tx) => selectLocations(tx, ctx));
}

async function selectLocations(
  tx: TenantTx,
  ctx: ActionCtx,
): Promise<LocationAdminRow[]> {
  const rows = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, ctx.tenantId), isNull(locations.deletedAt)))
    .orderBy(asc(locations.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as LocationKind,
    isPrimary: row.isPrimary,
    address: (row.address as LocationAdminRow["address"]) ?? null,
    createdAt: row.createdAt.toISOString(),
  })).sort(
    // The primary location leads; Postgres boolean ordering would put
    // false first (asc), so the re-sort is deliberate and local.
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name),
  );
}

export async function createLocation(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LocationMutationResult> {
  const parsed = createLocationInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid location." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(locations)
      .values({
        tenantId: ctx.tenantId,
        name: parsed.data.name,
        kind: parsed.data.kind,
        isPrimary: false,
        address: parsed.data.address ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: locations.id });
    if (!row) return { ok: false, error: "The location could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "location.create",
      entityType: "location",
      entityId: row.id,
      after: {
        name: parsed.data.name,
        kind: parsed.data.kind,
        address: parsed.data.address ?? null,
      },
      requestId: ctx.requestId,
    });
    return { ok: true, id: row.id };
  });
}

export async function updateLocation(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LocationMutationResult> {
  const parsed = updateLocationInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid location." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const existingRows = await tx
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.id, parsed.data.locationId),
          eq(locations.tenantId, ctx.tenantId),
          isNull(locations.deletedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return { ok: false, error: "Location not found." };

    const patch: Partial<typeof locations.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
    if (parsed.data.address !== undefined) patch.address = parsed.data.address;

    await tx
      .update(locations)
      .set(patch)
      .where(
        and(eq(locations.id, parsed.data.locationId), eq(locations.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "location.update",
      entityType: "location",
      entityId: parsed.data.locationId,
      before: {
        name: existing.name,
        kind: existing.kind,
        address: existing.address,
      },
      after: {
        name: patch.name ?? existing.name,
        kind: patch.kind ?? existing.kind,
        address: patch.address !== undefined ? patch.address : existing.address,
      },
      requestId: ctx.requestId,
    });
    return { ok: true, id: parsed.data.locationId };
  });
}

export async function getBusinessHours(
  ctx: ActionCtx,
  locationId?: string,
): Promise<BusinessHours> {
  if (locationId) {
    const parsed = z.string().uuid().safeParse(locationId);
    if (!parsed.success) return { days: [] };
  }
  const resolved = await resolveConfig<BusinessHours>(
    ctx.tenantId,
    BUSINESS_HOURS_KEY,
    locationId ? { locationId } : {},
  );
  const parsed = businessHoursSchema.safeParse(resolved.value);
  return parsed.success ? parsed.data : { days: [] };
}

export async function setBusinessHours(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LocationMutationResult> {
  const inputSchema = z.object({
    locationId: z.string().uuid(),
    hours: businessHoursSchema,
  });
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid hours." };
  }
  const locationId = parsed.data.locationId;

  const exists = await withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.id, locationId),
          eq(locations.tenantId, ctx.tenantId),
          isNull(locations.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(rows[0]);
  });
  if (!exists) return { ok: false, error: "Location not found." };

  // setTenantConfigValue writes the `config.set` audit row inside its
  // own transaction (and validates against the code catalogue).
  const result = await setTenantConfigValue({
    tenantId: ctx.tenantId,
    key: BUSINESS_HOURS_KEY,
    value: parsed.data.hours,
    locationId,
    actorId: ctx.userId,
  });
  return result.ok
    ? { ok: true, id: locationId }
    : { ok: false, error: result.error };
}
