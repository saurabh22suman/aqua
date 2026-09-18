import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenantModules } from "@/db/schema/modules";
import {
  getModuleRecord,
  listModuleRecords,
  type ModuleRecord,
} from "@/db/platform-modules";
import { tenantHasNonSampleData } from "@/db/sample-data-state";
import { writeAudit } from "@/lib/audit/write";
import {
  normalizeCapabilities,
  type ActivityTypeCapabilities,
} from "@/lib/services/activity-types";
import type { ActionCtx } from "@/lib/auth/context";

// M-04/M-05 — the module registry service. `modules` is the platform
// catalogue (read through db/platform-modules.ts); `tenant_modules` is
// tenant data (withTenant). Apply is idempotent and audited exactly
// once; upgrade is explicit and refuses a non-additive change once the
// tenant has non-sample data (the same lock applyPreset uses).
//
// No code branches on the module key: a module is rows plus declared
// keys, and the contract test proves every declared key resolves.

export type ModuleForTenant = {
  key: string;
  name: string;
  version: number;
  status: ModuleRecord["status"];
  capabilities: ActivityTypeCapabilities;
  presetKeys: string[];
  configKeys: string[];
  featureKeys: string[];
  enabled: boolean;
  enabledVersion: number | null;
  enabledAt: string | null;
};

export type ModuleMutationResult =
  | { ok: true; idempotent: boolean }
  | { ok: false; error: string };

export type RegisterModuleResult =
  | { ok: true; key: string; idempotent: boolean }
  | { ok: false; error: string };

export type ModuleDeclaration = {
  key: string;
  presetKeys: readonly string[];
  configKeys: readonly string[];
  featureKeys: readonly string[];
};

export type ModuleRegistrySnapshot = {
  presetKeys: ReadonlySet<string>;
  configKeys: ReadonlySet<string>;
  featureKeys: ReadonlySet<string>;
};

export type UnresolvedModuleKey = {
  moduleKey: string;
  kind: "preset" | "config" | "feature";
  key: string;
};

// M-04's contract check, as a pure function so the test can inject a
// known-bad declaration and prove the same code that passes on the
// real registry fails on the bad one.
export function findUnresolvedModuleKeys(
  declarations: readonly ModuleDeclaration[],
  registry: ModuleRegistrySnapshot,
): UnresolvedModuleKey[] {
  const unresolved: UnresolvedModuleKey[] = [];
  const check = (
    moduleKey: string,
    kind: UnresolvedModuleKey["kind"],
    keys: readonly string[],
    known: ReadonlySet<string>,
  ): void => {
    for (const key of keys) {
      if (!known.has(key)) unresolved.push({ moduleKey, kind, key });
    }
  };
  for (const declaration of declarations) {
    check(declaration.key, "preset", declaration.presetKeys, registry.presetKeys);
    check(declaration.key, "config", declaration.configKeys, registry.configKeys);
    check(declaration.key, "feature", declaration.featureKeys, registry.featureKeys);
  }
  return unresolved;
}

function toModuleForTenant(
  record: ModuleRecord,
  enabled: { version: number; enabledAt: Date } | undefined,
): ModuleForTenant {
  return {
    key: record.key,
    name: record.name,
    version: record.version,
    status: record.status,
    capabilities: normalizeCapabilities(record.capabilities),
    presetKeys: record.presetKeys,
    configKeys: record.configKeys,
    featureKeys: record.featureKeys,
    enabled: enabled !== undefined,
    enabledVersion: enabled?.version ?? null,
    enabledAt: enabled?.enabledAt.toISOString() ?? null,
  };
}

export async function listModulesForTenant(
  ctx: ActionCtx,
): Promise<ModuleForTenant[]> {
  const records = await listModuleRecords();
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(tenantModules)
      .where(eq(tenantModules.tenantId, ctx.tenantId));
    const byKey = new Map(rows.map((row) => [row.moduleKey, row]));
    return records.map((record) => toModuleForTenant(record, byKey.get(record.key)));
  });
}

export async function registerTenantModule(
  ctx: ActionCtx,
  moduleKey: string,
): Promise<RegisterModuleResult> {
  const record = await getModuleRecord(moduleKey);
  if (!record) return { ok: false, error: `Unknown module "${moduleKey}".` };

  return withTenant(ctx.tenantId, async (tx) => {
    const existing = await tx
      .select({ version: tenantModules.version })
      .from(tenantModules)
      .where(
        and(
          eq(tenantModules.tenantId, ctx.tenantId),
          eq(tenantModules.moduleKey, moduleKey),
        ),
      )
      .limit(1);
    if (existing[0]) return { ok: true, key: moduleKey, idempotent: true };

    await tx.insert(tenantModules).values({
      tenantId: ctx.tenantId,
      moduleKey,
      version: record.version,
      enabledBy: ctx.userId ?? null,
    });
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "module.register",
      entityType: "tenant_module",
      entityId: null,
      after: { moduleKey, version: record.version },
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, key: moduleKey, idempotent: false };
  });
}

export type ModuleApplyOptions = { additive?: boolean };

// Idempotent by construction: an existing row at the registry version
// is returned untouched and writes no audit row. An existing row at a
// DIFFERENT version is refused — version changes are explicit
// (upgradeModule), never an implicit side effect of apply.
export async function applyModule(
  ctx: ActionCtx,
  moduleKey: string,
  options: ModuleApplyOptions = {},
): Promise<ModuleMutationResult> {
  const record = await getModuleRecord(moduleKey);
  if (!record) return { ok: false, error: `Unknown module "${moduleKey}".` };

  return withTenant(ctx.tenantId, async (tx) => {
    const existing = await tx
      .select({ version: tenantModules.version })
      .from(tenantModules)
      .where(
        and(
          eq(tenantModules.tenantId, ctx.tenantId),
          eq(tenantModules.moduleKey, moduleKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      if (existing[0].version === record.version) {
        return { ok: true, idempotent: true } satisfies ModuleMutationResult;
      }
      return {
        ok: false,
        error: `Module "${moduleKey}" is already applied at version ${existing[0].version}; use upgradeModule.`,
      };
    }

    if (!options.additive && (await tenantHasNonSampleData(tx, ctx.tenantId))) {
      return {
        ok: false,
        error: `Tenant has real (non-sample) data — applying "${moduleKey}" non-additively is locked. Apply additively or edit by hand.`,
      };
    }

    await tx.insert(tenantModules).values({
      tenantId: ctx.tenantId,
      moduleKey,
      version: record.version,
      enabledBy: ctx.userId ?? null,
    });
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "module.apply",
      entityType: "tenant_module",
      entityId: null,
      after: { moduleKey, version: record.version, additive: options.additive ?? false },
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, idempotent: false };
  });
}

export async function upgradeModule(
  ctx: ActionCtx,
  moduleKey: string,
  version: number,
  options: ModuleApplyOptions = {},
): Promise<ModuleMutationResult> {
  const record = await getModuleRecord(moduleKey);
  if (!record) return { ok: false, error: `Unknown module "${moduleKey}".` };
  if (version > record.version) {
    return {
      ok: false,
      error: `Version ${version} is not registered for "${moduleKey}" (latest is ${record.version}).`,
    };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const existing = await tx
      .select({ version: tenantModules.version })
      .from(tenantModules)
      .where(
        and(
          eq(tenantModules.tenantId, ctx.tenantId),
          eq(tenantModules.moduleKey, moduleKey),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Module "${moduleKey}" is not applied; apply it first.` };
    }
    const from = existing[0].version;
    if (from === version) return { ok: true, idempotent: true } satisfies ModuleMutationResult;
    if (from > version) {
      return { ok: false, error: `Module "${moduleKey}" is at version ${from}; downgrades are not supported.` };
    }

    if (!options.additive && (await tenantHasNonSampleData(tx, ctx.tenantId))) {
      return {
        ok: false,
        error: `Tenant has real (non-sample) data — upgrading "${moduleKey}" to version ${version} non-additively is locked. Mark the version additive or edit by hand.`,
      };
    }

    await tx
      .update(tenantModules)
      .set({ version })
      .where(
        and(
          eq(tenantModules.tenantId, ctx.tenantId),
          eq(tenantModules.moduleKey, moduleKey),
        ),
      );
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "module.upgrade",
      entityType: "tenant_module",
      entityId: null,
      before: { moduleKey, version: from },
      after: { moduleKey, version, additive: options.additive ?? false },
      changedFields: ["version"],
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, idempotent: false };
  });
}
