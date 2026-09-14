import { asc } from "drizzle-orm";
import { withTenant } from "./tenant";
import { configKeys } from "./schema/config";
import {
  resolveConfigInTx,
  setTenantConfigValue,
  type ResolvedConfig,
  type SetConfigResult,
} from "./config";
import {
  CONFIG_KEYS,
  type ConfigKeyName,
  type ConfigRisk,
  type ConfigVisibility,
} from "./config-definitions";
import type { TenantId, UserId } from "@/lib/ids";

// O-07 (docs/ops-platform-design.md §4) — the owner-facing view of the
// registry. Owners see outcomes, never mechanisms: only keys with
// visibility owner_edit or owner_read are listed, each with its current
// value and where it came from. Writes are owner_edit only; owner_read
// keys go through the change-request path (db/config-requests.ts).

export type OwnerConfigItem = {
  key: ConfigKeyName;
  value: unknown;
  visibility: Exclude<ConfigVisibility, "ops_only">;
  risk: ConfigRisk;
  description: string;
  jsonSchema: Record<string, unknown>;
  source: ResolvedConfig["source"];
  editable: boolean;
};

export async function listOwnerVisibleConfig(
  tenantId: TenantId,
): Promise<OwnerConfigItem[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(configKeys)
      .orderBy(asc(configKeys.key));

    const items: OwnerConfigItem[] = [];
    for (const row of rows) {
      if (row.visibility === "ops_only") continue;
      // The code catalogue is the validation source; a key that only
      // exists in the database (a test fixture, a retired key) is not
      // renderable to owners.
      if (!(row.key in CONFIG_KEYS)) continue;
      const key = row.key as ConfigKeyName;
      const resolved = await resolveConfigInTx(tx, tenantId, key);
      items.push({
        key,
        value: resolved.value,
        visibility: row.visibility as OwnerConfigItem["visibility"],
        risk: resolved.risk,
        description: row.description,
        jsonSchema: row.valueSchema,
        source: resolved.source,
        editable: row.visibility === "owner_edit",
      });
    }
    return items;
  });
}

export async function setOwnerConfigValue(
  ctx: { tenantId: TenantId; userId?: UserId },
  key: string,
  value: unknown,
): Promise<SetConfigResult> {
  if (!(key in CONFIG_KEYS)) {
    return { ok: false, error: "Unknown configuration key." };
  }
  // Visibility (owner_edit only) and value validation both live in
  // setTenantConfigValue, so there is exactly one gate.
  return setTenantConfigValue({
    tenantId: ctx.tenantId,
    key: key as ConfigKeyName,
    value,
    actorId: ctx.userId,
  });
}
