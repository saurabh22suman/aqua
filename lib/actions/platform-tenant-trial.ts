"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  setTenantTrialDeadline,
  type TenantTrialResult,
} from "@/db/platform-tenant-trial";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import {
  recordOpsMutationTrace,
  recordOpsThrownFailure,
} from "@/lib/auth/ops-operation";
import { opsAction } from "@/db/ops-action";
import { asTenantId, asUserId } from "@/lib/ids";
import { IST_TIME_ZONE, parseCalendarDate } from "@/lib/time/calendar";
import { formatWallTime24hIST, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";

const WALL_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

const trialDeadlineFormInputSchema = z.object({
  tenantId: z.string().uuid(),
  // The operator's wall time in IST, e.g. "2027-03-04T05:06". An empty
  // value is the CLEAR.
  expiresAtIst: z.string(),
  // REQUIRED: the deadline the operator saw. An empty field means there
  // was none. A MISSING field fails the parse, so a form that lost the
  // value can never slip past the stale guard.
  expectedExpiresAt: z
    .string()
    .datetime({ offset: true })
    .or(z.literal("").transform(() => null)),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required for a trial deadline change.")
    .max(500),
});

/**
 * The canonical instant of an IST wall time, or null when the value is
 * not a real date and time.
 *
 * The strict calendar parser does the day: 30 February is not a day,
 * and a permissive read would roll it over to 2 March.
 */
function istWallTimeToInstant(wallTime: string): string | null {
  const match = WALL_TIME_PATTERN.exec(wallTime.trim());
  if (!match) return null;
  const [, day, hour, minute] = match;
  if (!parseCalendarDate(day)) return null;
  if (Number(hour) > 23 || Number(minute) > 59) return null;
  return zonedWallTimeToInstant(day, `${hour}:${minute}`, IST_TIME_ZONE).toISOString();
}

export async function setTenantTrialDeadlineAction(
  _prev: unknown,
  formData: FormData,
): Promise<TenantTrialResult> {
  // (1) parse
  const expectedExpiresAt = formData.get("expectedExpiresAt");
  const surface = trialDeadlineFormInputSchema.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    expiresAtIst: formData.get("expiresAtIst") ?? undefined,
    expectedExpiresAt:
      expectedExpiresAt === null ? undefined : expectedExpiresAt.toString(),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!surface.success) {
    await recordOpsMutationTrace("tenant.trial_deadline.set", "invalid");
    return {
      kind: "refused",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  // (2) platform session, fully past 2FA.
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await recordOpsMutationTrace("tenant.trial_deadline.set", "denied");
    return {
      kind: "refused",
      code: "denied",
      message:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
  }

  // (3) the operator's wall time becomes the canonical instant. An
  // impossible date or time is refused, and it never removes a stored
  // deadline.
  const wallTime = surface.data.expiresAtIst.trim();
  let expiresAt: string | null = null;
  if (wallTime !== "") {
    const instant = istWallTimeToInstant(wallTime);
    if (!instant) {
      await recordOpsMutationTrace("tenant.trial_deadline.set", "invalid", {
        tenantId: surface.data.tenantId,
      });
      return {
        kind: "refused",
        code: "invalid",
        message: "That is not a real date and time.",
      };
    }
    const expected = surface.data.expectedExpiresAt;
    const expectedDate = expected === null ? null : new Date(expected);
    const expectedWallTime = expectedDate
      ? `${todayInZone(IST_TIME_ZONE, expectedDate.getTime())}T${formatWallTime24hIST(expectedDate)}`
      : null;
    expiresAt = wallTime === expectedWallTime ? expected : instant;
  }

  const result = await opsAction(
    {
      scope: "tenant.trial_deadline.set",
      actorId: asUserId(status.userId),
      tenantId: surface.data.tenantId,
      reason: surface.data.reason,
      targetType: "tenant",
      targetId: surface.data.tenantId,
    },
    () =>
      setTenantTrialDeadline(asTenantId(surface.data.tenantId), {
        expiresAt,
        expectedExpiresAt: surface.data.expectedExpiresAt,
        reason: surface.data.reason,
      }, {
        actorId: asUserId(status.userId),
      }),
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("tenant.trial_deadline.set", error, {
      tenantId: surface.data.tenantId,
    });
    throw error;
  });

  if (result.kind === "applied") {
    revalidatePath(`/ops/tenants/${surface.data.tenantId}`);
    return result;
  }

  // The ONE refusal event, with the canonical outcome vocabulary.
  await recordOpsMutationTrace(
    "tenant.trial_deadline.set",
    result.code === "denied"
      ? "denied"
      : result.code === "not_audited"
        ? "error"
        : "invalid",
    { tenantId: surface.data.tenantId },
  );
  return result;
}
