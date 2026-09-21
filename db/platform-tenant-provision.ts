import { db } from "./client";
import { withPlatform } from "./scope";
import { platformAuditLog } from "./schema/platform-users";
import { applyPreset } from "./preset-engine";
import {
  registerAbsenceAlertsSchedule,
  registerBillingSchedules,
  registerSessionsGenerateSchedule,
} from "./queue";
import type { TenantId, UserId } from "@/lib/ids";

// PR1-C6/C8 — what happens after createTenant's atomic transaction
// commits: apply the onboarding preset and register the pg-boss
// schedules. Split out of db/platform-tenant-create.ts to keep that
// file under the line-count hard limit (it was 416 after the preset
// work) and because both steps share one contract: the tenant already
// exists and is usable, so a failure is surfaced (warning + platform
// audit row) and retried from a UI path rather than rolled back.

export type ProvisioningResult = {
  presetKey: string | null;
  presetApplied: boolean;
  presetWarning: string | null;
};

export async function finishTenantProvisioning(input: {
  tenantId: TenantId;
  timezone: string;
  presetKey?: string;
  actorId: UserId;
}): Promise<ProvisioningResult> {
  const { tenantId, timezone, presetKey, actorId } = input;

  let presetApplied = false;
  let presetWarning: string | null = null;

  const auditFailure = async (action: string, message: string) => {
    await withPlatform(async () => {
      await db.insert(platformAuditLog).values({
        actorId,
        tenantId,
        action,
        targetType: "tenant",
        targetId: tenantId,
        detail: { presetKey: presetKey ?? null, message },
      });
    }).catch((auditErr) => {
      console.error(
        `createTenant: failed to write ${action} audit row for tenant ${tenantId}`,
        auditErr,
      );
    });
  };

  if (presetKey) {
    try {
      const presetResult = await applyPreset(tenantId, presetKey, { actorId });
      if (presetResult.kind === "ok") {
        presetApplied = true;
      } else {
        presetWarning = `The tenant was created, but preset "${presetKey}" was not applied (${presetResult.kind}). Apply it from the preset catalogue — re-applying is idempotent.`;
        await auditFailure("tenant.preset_apply_failed", presetResult.kind);
      }
    } catch (err) {
      presetWarning = `The tenant was created, but preset "${presetKey}" failed to apply. Apply it from the preset catalogue — re-applying is idempotent.`;
      await auditFailure(
        "tenant.preset_apply_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    presetWarning =
      "No preset was applied. Apply one from the preset catalogue before adding real data.";
  }

  // D2 — pg-boss is a separate connection, not part of the
  // tenant/location/audit atomicity, and the tenant already exists by
  // this point regardless of what happens here. Best-effort:
  // db/deploy.ts's syncSessionGenerateSchedules reconciles any tenant
  // missing a schedule on the next deploy. But "best-effort" must not
  // mean "silent" — a swallowed failure here is the exact bug D2
  // fixes, one layer down. error-level log carries the tenant id for
  // grepping, and a platform_audit_log row makes it visible on the
  // tenant detail page's "Recent activity" list.
  try {
    await registerSessionsGenerateSchedule(tenantId, timezone);
    // R.8 — absence alerts run daily alongside session generation.
    await registerAbsenceAlertsSchedule(tenantId, timezone);
    // C-47 — the nightly billing jobs (expire / generate / rollup).
    await registerBillingSchedules(tenantId, timezone);
  } catch (err) {
    console.error(
      `createTenant: failed to register schedules for tenant ${tenantId}`,
      err,
    );
    await auditFailure(
      "tenant.schedule_registration_failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  return { presetKey: presetKey ?? null, presetApplied, presetWarning };
}
