import { asc, eq } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { modules } from "./schema/modules";

// M-04 — the platform read path for the module registry. `modules` is
// in db/allowlist.ts, so reads go through db/client under
// withPlatform(); lib/services/modules.ts must not import db/client.

export type ModuleRecord = {
  key: string;
  name: string;
  version: number;
  status: "ga" | "beta" | "internal" | "retired";
  capabilities: unknown;
  presetKeys: string[];
  configKeys: string[];
  featureKeys: string[];
};

export async function listModuleRecords(): Promise<ModuleRecord[]> {
  return withPlatform(async () => {
    const rows = await db
      .select({
        key: modules.key,
        name: modules.name,
        version: modules.version,
        status: modules.status,
        capabilities: modules.capabilities,
        presetKeys: modules.presetKeys,
        configKeys: modules.configKeys,
        featureKeys: modules.featureKeys,
      })
      .from(modules)
      .orderBy(asc(modules.name), asc(modules.key));
    return rows.map((row) => ({
      ...row,
      status: row.status as ModuleRecord["status"],
    }));
  });
}

export async function getModuleRecord(
  key: string,
): Promise<ModuleRecord | null> {
  return withPlatform(async () => {
    const rows = await db
      .select({
        key: modules.key,
        name: modules.name,
        version: modules.version,
        status: modules.status,
        capabilities: modules.capabilities,
        presetKeys: modules.presetKeys,
        configKeys: modules.configKeys,
        featureKeys: modules.featureKeys,
      })
      .from(modules)
      .where(eq(modules.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, status: row.status as ModuleRecord["status"] };
  });
}
