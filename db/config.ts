import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant, type TenantTx } from "./tenant";
import { withPlatformAdmin } from "./scope";
import { configKeys, configValues, type ConfigValue } from "./schema/config";
import { tenants } from "./schema/tenants";
import { auditLog } from "./schema/audit";
import { recordOpsAudit } from "./ops-action";
import { resolvePresetScope } from "./preset-engine";
import {
  CONFIG_KEYS,
  type ConfigKeyDefinition,
  type ConfigKeyName,
  type ConfigRisk,
  type ConfigVisibility,
} from "./config-definitions";
import type { TenantId, UserId } from "@/lib/ids";

// O-04 (docs/ops-platform-design.md §2–§3) — the resolver.
//
// Resolution order is fixed: platform → plan → preset → tenant →
// location. It returns the value AND its provenance (which scope set
// it, who, when) — the support question is almost never "what is the
// value" but "why is it that, and who did it".
//
// Writes are append-only: a write supersedes the current live row for
// its (key, scope, scope_id) and inserts the new one in the same
// transaction. Every write is Zod-validated against the code catalogue
// and a dangerous key requires a reason.

export type ConfigScopeType =
  | "platform"
  | "plan"
  | "preset"
  | "tenant"
  | "location"
  | "activity";

export type ResolvedConfig<T = unknown> = {
  key: ConfigKeyName;
  value: T;
  visibility: ConfigVisibility;
  risk: ConfigRisk;
  description: string;
  source: {
    scopeType: ConfigScopeType | "default";
    scopeId: string | null;
    setBy: string | null;
    setAt: Date | null;
  };
};

export type ResolveOptions = { locationId?: string; activityId?: string };

// In-tx resolver for services that already hold a withTenant()
// transaction (nesting withTenant inside withTenant throws by design).
export async function resolveConfigInTx<T = unknown>(
  tx: TenantTx,
  tenantId: TenantId,
  key: ConfigKeyName,
  options: ResolveOptions = {},
): Promise<ResolvedConfig<T>> {
  const definition = CONFIG_KEYS[key];

  const tenantRows = await tx
    .select({ planId: tenants.planId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    throw new Error(`resolveConfig: no tenant "${tenantId}".`);
  }

  // Preset scope follows the location's own binding when a location is
  // given; otherwise the tenant's owning preset. The lookup lives in
  // the preset engine for the architecture §7.4 rule-6 read whitelist.
  const presetRef = await resolvePresetScope(tx, tenantId, options.locationId);

  const live = await tx
    .select()
    .from(configValues)
    .where(and(eq(configValues.key, key), isNull(configValues.supersededAt)))
    .orderBy(asc(configValues.setAt));

  const candidates: Array<{ scopeType: ConfigScopeType; scopeId: string | null }> = [
    { scopeType: "platform", scopeId: null },
    { scopeType: "plan", scopeId: tenant.planId },
    { scopeType: "preset", scopeId: presetRef },
    { scopeType: "tenant", scopeId: tenantId as string },
    { scopeType: "location", scopeId: options.locationId ?? null },
    { scopeType: "activity", scopeId: options.activityId ?? null },
  ];

  let chosen: { row: ConfigValue; scopeType: ConfigScopeType; scopeId: string | null } | null =
    null;
  for (const candidate of candidates) {
    if (candidate.scopeType !== "platform" && candidate.scopeId === null) continue;
    const row = live.find(
      (r) =>
        r.scopeType === candidate.scopeType &&
        (r.scopeId ?? null) === candidate.scopeId,
    );
    if (row) chosen = { row, scopeType: candidate.scopeType, scopeId: candidate.scopeId };
  }

  if (!chosen) {
    return {
      key,
      value: definition.defaultValue as T,
      visibility: definition.visibility,
      risk: definition.risk,
      description: definition.description,
      source: { scopeType: "default", scopeId: null, setBy: null, setAt: null },
    };
  }

  return {
    key,
    value: definition.valueSchema.parse(chosen.row.value) as T,
    visibility: definition.visibility,
    risk: definition.risk,
    description: definition.description,
    source: {
      scopeType: chosen.scopeType,
      scopeId: chosen.scopeId,
      setBy: chosen.row.setBy,
      setAt: chosen.row.setAt,
    },
  };
}

export async function resolveConfig<T = unknown>(
  tenantId: TenantId,
  key: ConfigKeyName,
  options: ResolveOptions = {},
): Promise<ResolvedConfig<T>> {
  return withTenant(tenantId, (tx) =>
    resolveConfigInTx<T>(tx, tenantId, key, options),
  );
}

export async function resolveAllConfig(
  tenantId: TenantId,
  options: ResolveOptions = {},
): Promise<ResolvedConfig[]> {
  return withTenant(tenantId, async (tx) => {
    const results: ResolvedConfig[] = [];
    for (const key of Object.keys(CONFIG_KEYS) as ConfigKeyName[]) {
      results.push(await resolveConfigInTx(tx, tenantId, key, options));
    }
    return results;
  });
}

export type SetConfigResult =
  | { ok: true; scopeType: ConfigScopeType; scopeId: string | null }
  | { ok: false; error: string };

export async function setTenantConfigValue(params: {
  tenantId: TenantId;
  key: ConfigKeyName;
  value: unknown;
  locationId?: string;
  actorId?: UserId;
  reason?: string;
}): Promise<SetConfigResult> {
  // Widened deliberately: no key is `dangerous` yet, but the guard is
  // real for the day one is.
  // O-07 — tenant writes are owner_edit only. owner_read keys are
  // changed by ops after a change request (db/config-requests.ts);
  // ops_only keys are never tenant-writable. Fails closed.
  const definition: ConfigKeyDefinition = CONFIG_KEYS[params.key];
  if (definition.visibility !== "owner_edit") {
    return {
      ok: false,
      error:
        definition.visibility === "owner_read"
          ? "This setting is changed by the platform — send a change request instead."
          : "This key is set by the platform.",
    };
  }
  const parsed = definition.valueSchema.safeParse(params.value);
  if (!parsed.success) {
    return { ok: false, error: `Invalid value for ${params.key}.` };
  }
  if (definition.risk === "dangerous" && !params.reason?.trim()) {
    return { ok: false, error: `A reason is required to change ${params.key}.` };
  }

  const scopeType: ConfigScopeType = params.locationId ? "location" : "tenant";
  const scopeId = params.locationId ?? (params.tenantId as string);

  return withTenant(params.tenantId, async (tx) => {
    const tenantRows = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, params.tenantId))
      .limit(1);
    if (!tenantRows[0]) return { ok: false, error: "Tenant not found." };

    const now = new Date();
    await supersedeLiveValue(tx, params.key, scopeType, scopeId, now);
    await tx.insert(configValues).values({
      key: params.key,
      scopeType,
      scopeId,
      tenantId: params.tenantId,
      value: parsed.data,
      setBy: params.actorId ?? null,
      setAt: now,
      reason: params.reason ?? null,
    });

    if (params.actorId) {
      await tx.insert(auditLog).values({
        tenantId: params.tenantId,
        actorId: params.actorId,
        action: "config.set",
        entityType: "config_key",
        entityId: null,
        after: {
          key: params.key,
          scopeType,
          scopeId,
          value: parsed.data,
          reason: params.reason ?? null,
        },
      });
    }
    return { ok: true, scopeType, scopeId };
  });
}

// Platform-scope writes (platform/plan/preset) are ops actions: they
// run under withPlatformAdmin and audit to platform_audit_log, because
// audit_log.actor_id references tenant users and a platform operator is
// not one. O-05's wrapper will route these through one pipeline.
export async function setPlatformConfigValue(params: {
  key: ConfigKeyName;
  scopeType: "platform" | "plan" | "preset";
  scopeId?: string;
  value: unknown;
  actorId: UserId;
  reason?: string;
}): Promise<SetConfigResult> {
  const definition: ConfigKeyDefinition = CONFIG_KEYS[params.key];
  const parsed = definition.valueSchema.safeParse(params.value);
  if (!parsed.success) {
    return { ok: false, error: `Invalid value for ${params.key}.` };
  }
  if (definition.risk === "dangerous" && !params.reason?.trim()) {
    return { ok: false, error: `A reason is required to change ${params.key}.` };
  }
  const scopeId = params.scopeType === "platform" ? null : (params.scopeId ?? null);
  if (params.scopeType !== "platform" && scopeId === null) {
    return { ok: false, error: `A scope id is required for ${params.scopeType} scope.` };
  }

  return withPlatformAdmin(async (tx) => {
    const now = new Date();
    await supersedeLiveValue(tx, params.key, params.scopeType, scopeId, now);
    await tx.insert(configValues).values({
      key: params.key,
      scopeType: params.scopeType,
      scopeId,
      tenantId: null,
      value: parsed.data,
      setBy: params.actorId,
      setAt: now,
      reason: params.reason ?? null,
    });
    await recordOpsAudit(tx, {
      action: "config.set",
      actorId: params.actorId,
      tenantId: null,
      targetType: "config_key",
      targetId: null,
      after: { value: parsed.data },
      detail: {
        key: params.key,
        scopeType: params.scopeType,
        scopeId,
        value: parsed.data,
        reason: params.reason ?? null,
      },
    });
    return { ok: true, scopeType: params.scopeType, scopeId };
  });
}

export async function listConfigCatalogue() {
  return withPlatformAdmin(async (tx) =>
    tx
      .select()
      .from(configKeys)
      .orderBy(asc(configKeys.key)),
  );
}

async function supersedeLiveValue(
  tx: TenantTx,
  key: ConfigKeyName,
  scopeType: ConfigScopeType,
  scopeId: string | null,
  now: Date,
): Promise<void> {
  await tx
    .update(configValues)
    .set({ supersededAt: now })
    .where(
      and(
        eq(configValues.key, key),
        eq(configValues.scopeType, scopeType),
        scopeId === null
          ? isNull(configValues.scopeId)
          : eq(configValues.scopeId, scopeId),
        isNull(configValues.supersededAt),
      ),
    );
}
