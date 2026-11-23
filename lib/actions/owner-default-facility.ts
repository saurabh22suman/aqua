"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permission";
import { notFound } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_OWNER } from "@/lib/auth/surface-access";
import { canSelectFacility } from "@/lib/services/selected-facility-access";
import { ownerDefaultFacilityKey, workspacePreferenceCookie } from "@/lib/services/workspace-opening";

type DefaultFacilityState = { error?: string; saved?: boolean };
const facilityPreference = z.union([z.literal("all"), z.string().uuid()]);

export async function saveOwnerDefaultFacilityAction(
  _previous: DefaultFacilityState,
  form: FormData,
): Promise<DefaultFacilityState> {
  const preference = facilityPreference.safeParse(form.get("facility"));
  const ctx = await requireDefaultCtx();
  if (!canAccessSurface(ctx.roleKey, SURFACE_OWNER)) notFound();
  requirePermission(ctx, "dashboard.view");
  if (!preference.success) return { error: "Choose All or an available facility." };
  if (preference.data !== "all" && !await canSelectFacility(ctx, preference.data)) {
    return { error: "That facility is no longer available. Choose All or reload to see available facilities." };
  }
  const store = await cookies();
  const key = ownerDefaultFacilityKey(ctx);
  if (preference.data === "all") store.delete(key);
  else store.set(key, preference.data, workspacePreferenceCookie);
  return { saved: true };
}
