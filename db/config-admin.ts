import { and, eq, isNull } from "drizzle-orm";
import { withPlatformAdmin } from "./scope";
import { configValues } from "./schema/config";
import { recordOpsAudit } from "./ops-action";
import type { SetConfigResult } from "./config";
import type { TenantTx } from "./tenant";
import {
  CONFIG_KEYS,
  type ConfigKeyDefinition,
  type ConfigKeyName,
} from "./config-definitions";
import type { TenantId, UserId } from "@/lib/ids";

// Ops writing a configuration value. The owner path
// (db/config-owner.ts) handles owner_edit tenant-scope keys; this is
// the platform's path for any key the console edits — access
// boundaries, kill switches, the GST rate per facility/activity, and
// the value an owner asked for after a change request.
//
// Platform operators are not tenant users, so every write audits to
// platform_audit_log through the O-05 recorder. Validation always comes
// from the code catalogue.

export type PlatformConfigScope =
  | { scopeType: "tenant" }
  | { scopeType: "location"; scopeId: string }
  | { scopeType: "activity"; scopeId: string };

export type PlatformScopedConfigParams = {
  tenantId: TenantId;
  key: ConfigKeyName;
  value: unknown;
  scope: PlatformConfigScope;
  actorId: UserId;
  reason?: string;
};

export type PlatformTenantConfigParams = {
  tenantId: TenantId;
  key: ConfigKeyName;
  value: unknown;
  actorId: UserId;
  reason?: string;
};

export type PlatformConfigValidation =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function validatePlatformConfigValue(params: {
  key: ConfigKeyName;
  value: unknown;
}): PlatformConfigValidation {
  const definition: ConfigKeyDefinition = CONFIG_KEYS[params.key];
  const parsed = definition.valueSchema.safeParse(params.value);
  if (!parsed.success) {
    return { ok: false, error: `Invalid value for ${params.key}.` };
  }
  return { ok: true, value: parsed.data };
}

// Kept for the O-07 change-request resolution's import path.
export const validatePlatformTenantConfigValue = validatePlatformConfigValue;

function scopeIdFor(
  tenantId: TenantId,
  scope: PlatformConfigScope,
): string {
  return scope.scopeType === "tenant" ? (tenantId as string) : scope.scopeId;
}

// In-tx variant for callers that already hold a platform-admin
// transaction (the change-request resolution, the tax action):
// the write commits or rolls back with the caller's unit of work.
// No audit here — the caller records the row for the whole decision.
export async function applyPlatformScopedConfigValueInTx(
  tx: TenantTx,
  params: PlatformScopedConfigParams,
): Promise<SetConfigResult> {
  const validation = validatePlatformConfigValue(params);
  if (!validation.ok) return validation;

  const scopeId = scopeIdFor(params.tenantId, params.scope);
  const now = new Date();
  await tx
    .update(configValues)
    .set({ supersededAt: now })
    .where(
      and(
        eq(configValues.key, params.key),
        eq(configValues.scopeType, params.scope.scopeType),
        eq(configValues.scopeId, scopeId),
        isNull(configValues.supersededAt),
      ),
    );
  await tx.insert(configValues).values({
    key: params.key,
    scopeType: params.scope.scopeType,
    scopeId,
    tenantId: params.tenantId,
    value: validation.value,
    setBy: params.actorId,
    setAt: now,
    reason: params.reason ?? null,
  });
  return { ok: true, scopeType: params.scope.scopeType, scopeId };
}

// Standalone ops write: same transaction as its audit row.
export async function setPlatformScopedConfigValue(
  params: PlatformScopedConfigParams,
): Promise<SetConfigResult> {
  const validation = validatePlatformConfigValue(params);
  if (!validation.ok) return validation;

  return withPlatformAdmin(async (tx) => {
    const result = await applyPlatformScopedConfigValueInTx(tx, params);
    if (!result.ok) return result;
    await recordOpsAudit(tx, {
      action: "config.set",
      actorId: params.actorId,
      tenantId: params.tenantId,
      targetType: "config_key",
      targetId: null,
      after: { value: validation.value },
      detail: {
        key: params.key,
        scopeType: params.scope.scopeType,
        scopeId: result.scopeId,
        value: validation.value,
        reason: params.reason ?? null,
      },
    });
    return result;
  });
}

// Tenant-scope convenience kept for existing callers
// (db/config-requests.ts, O-08's tests).
export async function applyPlatformTenantConfigValueInTx(
  tx: TenantTx,
  params: PlatformTenantConfigParams,
): Promise<SetConfigResult> {
  return applyPlatformScopedConfigValueInTx(tx, {
    ...params,
    scope: { scopeType: "tenant" },
  });
}

export async function setPlatformTenantConfigValue(
  params: PlatformTenantConfigParams,
): Promise<SetConfigResult> {
  return setPlatformScopedConfigValue({
    ...params,
    scope: { scopeType: "tenant" },
  });
}
