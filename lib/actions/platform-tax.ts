"use server";

import { z } from "zod";
import { opsAction } from "@/db/ops-action";
import { setPlatformScopedConfigValue } from "@/db/config-admin";
import { GST_RATE_KEY, getTenantTaxConfig } from "@/lib/services/tax";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asTenantId, asUserId } from "@/lib/ids";

// GST rate configuration in the ops console. Owner-visible read of the
// rate happens through the registry; setting it is money semantics and
// stays ops-only.

const tenantIdInput = z.string().uuid();

const setRateInput = z.object({
  tenantId: z.string().uuid(),
  scopeType: z.enum(["tenant", "location", "activity"]),
  scopeId: z.string().uuid().optional(),
  rateBp: z.number().int().min(0).max(10000),
});

export async function getTenantTaxConfigAction(tenantId: string) {
  const parsed = tenantIdInput.safeParse(tenantId);
  if (!parsed.success) return null;
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") return null;
  return getTenantTaxConfig(asTenantId(parsed.data));
}

export async function setTenantTaxRateAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setRateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Enter a rate between 0% and 100%." };
  }
  if (parsed.data.scopeType !== "tenant" && !parsed.data.scopeId) {
    return { ok: false, error: "Missing scope reference." };
  }

  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }

  const scope =
    parsed.data.scopeType === "tenant"
      ? ({ scopeType: "tenant" } as const)
      : parsed.data.scopeType === "location"
        ? ({ scopeType: "location", scopeId: parsed.data.scopeId! } as const)
        : ({ scopeType: "activity", scopeId: parsed.data.scopeId! } as const);

  const result = await opsAction(
    {
      scope: "config.set",
      actorId: asUserId(status.userId),
      tenantId: parsed.data.tenantId,
      targetType: "config_key",
      detail: {
        key: GST_RATE_KEY,
        scopeType: parsed.data.scopeType,
        scopeId: parsed.data.scopeId ?? null,
      },
    },
    () =>
      setPlatformScopedConfigValue({
        tenantId: asTenantId(parsed.data.tenantId),
        key: GST_RATE_KEY,
        value: parsed.data.rateBp,
        scope,
        actorId: asUserId(status.userId),
        reason: "GST rate set from the ops console",
      }),
  );

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
