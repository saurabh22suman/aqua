import { asc, eq } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { activityTypes } from "./schema/activity-types";

// M-01 — the platform read path for the activity-type catalogue.
// `activity_types` is in db/allowlist.ts (platform table, RLS-exempt),
// so reads use db/client under withPlatform(); the service layer
// (lib/services/activity-types.ts) must not import db/client itself.

export type ActivityTypeRecord = {
  key: string;
  name: string;
  capabilities: unknown;
  sortOrder: number;
  status: "active" | "deprecated";
};

export async function listActivityTypeRecords(): Promise<ActivityTypeRecord[]> {
  return withPlatform(async () => {
    const rows = await db
      .select({
        key: activityTypes.key,
        name: activityTypes.name,
        capabilities: activityTypes.capabilities,
        sortOrder: activityTypes.sortOrder,
        status: activityTypes.status,
      })
      .from(activityTypes)
      .orderBy(asc(activityTypes.sortOrder), asc(activityTypes.key));
    return rows.map((r) => ({
      ...r,
      status: r.status as "active" | "deprecated",
    }));
  });
}

export async function getActivityTypeRecord(
  key: string,
): Promise<ActivityTypeRecord | null> {
  return withPlatform(async () => {
    const rows = await db
      .select({
        key: activityTypes.key,
        name: activityTypes.name,
        capabilities: activityTypes.capabilities,
        sortOrder: activityTypes.sortOrder,
        status: activityTypes.status,
      })
      .from(activityTypes)
      .where(eq(activityTypes.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, status: row.status as "active" | "deprecated" };
  });
}
