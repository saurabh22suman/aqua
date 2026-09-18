"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  businessHoursSchema,
  createLocation,
  createLocationInput,
  getBusinessHours,
  listAdminLocations,
  setBusinessHours,
  updateLocation,
  updateLocationInput,
  type BusinessHours,
  type LocationAdminRow,
  type LocationMutationResult,
} from "@/lib/services/locations";

// U-07 — location and business-hours actions. Standing preamble:
// (1) Zod parse, (2) permission check, then the service. Reads need
// settings.read; writes need settings.manage.

const locationIdInput = z.object({ locationId: z.string().uuid() });
const businessHoursInput = z.object({
  locationId: z.string().uuid(),
  hours: businessHoursSchema,
});

export async function listAdminLocationsAction(): Promise<LocationAdminRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return listAdminLocations(ctx);
}

export async function createLocationAction(
  raw: unknown,
): Promise<LocationMutationResult> {
  const parsed = createLocationInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid location." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return createLocation(ctx, parsed.data);
}

export async function updateLocationAction(
  raw: unknown,
): Promise<LocationMutationResult> {
  const parsed = updateLocationInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid location." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updateLocation(ctx, parsed.data);
}

export async function getBusinessHoursAction(locationId: string): Promise<BusinessHours> {
  const parsed = locationIdInput.safeParse({ locationId });
  if (!parsed.success) return { days: [] };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return getBusinessHours(ctx, parsed.data.locationId);
}

export async function setBusinessHoursAction(
  raw: unknown,
): Promise<LocationMutationResult> {
  const parsed = businessHoursInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid hours." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return setBusinessHours(ctx, parsed.data);
}
