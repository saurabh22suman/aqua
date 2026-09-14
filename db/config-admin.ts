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

// O-07/O-08 integration — ops writing a tenant-scope configuration
// value (an access boundary, a kill switch, the value an owner asked
// for). The owner path (db/config-owner.ts) is owner_edit only;
// owner_read keys change here, after a request
// (db/config-requests.ts resolves with applyValue).
//
// Platform operators are not tenant users, so the write audits to
// platform_audit_log through the O-05 recorder.

export type PlatformTenantConfigParams = {
  tenantId: TenantId;
  key: ConfigKeyName;
  value: unknown;
  actorId: UserId;
  reason?: string;
};

export type PlatformTenantConfigValidation =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function validatePlatformTenantConfigValue(
  params: Pick<PlatformTenantConfigParams, "key" | "value">,
): PlatformTenantConfigValidation {
  const definition: ConfigKeyDefinition = CONFIG_KEYS[params.key];
  const parsed = definition.valueSchema.safeParse(params.value);
  if (!parsed.success) {
    return { ok: false, error: `Invalid value for ${params.key}.` };
  }
  return { ok: true, value: parsed.data };
}

// In-tx variant for callers that already hold a platform-admin
// transaction (the change-request resolution): the write commits or
// rolls back with the resolution. No audit here — the caller records
// one row for the whole decision.
export async function applyPlatformTenantConfigValueInTx(
  tx: TenantTx,
  params: PlatformTenantConfigParams,
): Promise<SetConfigResult> {
  const validation = validatePlatformTenantConfigValue(params);
  if (!validation.ok) return validation;

  const now = new Date();
  await tx
    .update(configValues)
    .set({ supersededAt: now })
    .where(
      and(
        eq(configValues.key, params.key),
        eq(configValues.scopeType, "tenant"),
        eq(configValues.scopeId, params.tenantId),
        isNull(configValues.supersededAt),
      ),
    );
  await tx.insert(configValues).values({
    key: params.key,
    scopeType: "tenant",
    scopeId: params.tenantId,
    tenantId: params.tenantId,
    value: validation.value,
    setBy: params.actorId,
    setAt: now,
    reason: params.reason ?? null,
  });
  return { ok: true, scopeType: "tenant", scopeId: params.tenantId };
}

// Standalone ops write: same transaction as its audit row.
export async function setPlatformTenantConfigValue(
  params: PlatformTenantConfigParams,
): Promise<SetConfigResult> {
  const validation = validatePlatformTenantConfigValue(params);
  if (!validation.ok) return validation;

  return withPlatformAdmin(async (tx) => {
    const result = await applyPlatformTenantConfigValueInTx(tx, params);
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
        scopeType: "tenant",
        value: validation.value,
        reason: params.reason ?? null,
      },
    });
    return result;
  });
}
