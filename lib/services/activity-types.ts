import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { facilities } from "@/db/schema/preset-engine";
import { activityTypes } from "@/db/schema/activity-types";
import {
  getActivityTypeRecord,
  listActivityTypeRecords,
} from "@/db/platform-activity-types";
import type { ActionCtx } from "@/lib/auth/context";

// M-01 — activity type catalogue service. The platform half (list,
// capabilities-by-key) reads the RLS-exempt catalogue through
// db/platform-activity-types.ts; the tenant half (which activities at
// this academy use which type) goes through withTenant() because
// `facilities` is tenant data.
//
// Capabilities gate UI, never data integrity: callers branch on the
// flags to decide what to render, but no service refuses data because
// a capability is false.

export const ACTIVITY_CAPABILITY_KEYS = [
  "bookable",
  "attendance",
  "progress",
  "resource_based",
  "pos",
] as const;

export type ActivityCapability = (typeof ACTIVITY_CAPABILITY_KEYS)[number];
export type ActivityTypeCapabilities = Record<ActivityCapability, boolean>;

export function normalizeCapabilities(raw: unknown): ActivityTypeCapabilities {
  const source =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const out = {} as ActivityTypeCapabilities;
  for (const key of ACTIVITY_CAPABILITY_KEYS) {
    out[key] = source[key] === true;
  }
  return out;
}

export type ActivityTypeRow = {
  key: string;
  name: string;
  capabilities: ActivityTypeCapabilities;
  sortOrder: number;
  status: "active" | "deprecated";
};

export type TenantActivityRow = {
  id: string;
  locationId: string;
  name: string;
  kind: string;
  capacity: number;
  activityTypeKey: string | null;
  activityTypeName: string | null;
  capabilities: ActivityTypeCapabilities | null;
};

export async function listActivityTypes(): Promise<ActivityTypeRow[]> {
  const rows = await listActivityTypeRecords();
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    capabilities: normalizeCapabilities(row.capabilities),
    sortOrder: row.sortOrder,
    status: row.status,
  }));
}

export async function getActivityType(
  key: string,
): Promise<ActivityTypeRow | null> {
  const row = await getActivityTypeRecord(key);
  if (!row) return null;
  return {
    key: row.key,
    name: row.name,
    capabilities: normalizeCapabilities(row.capabilities),
    sortOrder: row.sortOrder,
    status: row.status,
  };
}

export async function getActivityTypeCapabilities(
  key: string,
): Promise<ActivityTypeCapabilities | null> {
  const row = await getActivityTypeRecord(key);
  return row ? normalizeCapabilities(row.capabilities) : null;
}

// The tenant's live activities joined to their (optional) kernel type.
// A NULL activity_type_key is a legitimate answer — the UI shows the
// raw `kind` when no catalogue type maps.
export async function listActivitiesForTenant(
  ctx: ActionCtx,
): Promise<TenantActivityRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: facilities.id,
        locationId: facilities.locationId,
        name: facilities.name,
        kind: facilities.kind,
        capacity: facilities.capacity,
        activityTypeKey: facilities.activityTypeKey,
        activityTypeName: activityTypes.name,
        capabilities: activityTypes.capabilities,
      })
      .from(facilities)
      .leftJoin(activityTypes, eq(activityTypes.key, facilities.activityTypeKey))
      .where(
        and(
          eq(facilities.tenantId, ctx.tenantId),
          isNull(facilities.deletedAt),
        ),
      )
      .orderBy(asc(facilities.name));
    return rows.map((row) => ({
      ...row,
      capabilities:
        row.activityTypeKey === null
          ? null
          : normalizeCapabilities(row.capabilities),
    }));
  });
}
