"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUserId } from "@/lib/ids";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import {
  recordOpsMutationTrace,
  recordOpsThrownFailure,
} from "@/lib/auth/ops-operation";
import { opsAction } from "@/db/ops-action";
import {
  revokeAllOperatorSessions,
  revokeOperatorSession,
} from "@/db/platform-operators-sessions";
import {
  setOperatorRole,
  setOperatorStatus,
} from "@/db/platform-operators-account";
import type { OperatorMutationOutcome } from "@/db/platform-operators-shared";

/**
 * The result of a maintenance action.
 *
 * The service's own outcome, unchanged, plus the one case the action
 * itself could not reach the service with. There is deliberately no
 * `ok: true` wrapper: a wrapper that says "ok" for a refusal is how a
 * refusal gets reported as a success.
 */
export type OperatorActionResult =
  | OperatorMutationOutcome
  | { kind: "error"; error: string };

const reasonInput = z.string().trim().min(1).max(500);

function refusalText(reason: "unauthenticated" | "forbidden"): string {
  return reason === "forbidden"
    ? "Your platform account has read-only access."
    : "Your session has expired. Sign in again.";
}

/** End one operator session. */
export async function revokeOperatorSessionAction(
  _prev: unknown,
  formData: FormData,
): Promise<OperatorActionResult> {
  const parsed = z
    .object({ sessionId: z.string().uuid(), reason: reasonInput })
    .safeParse({
      sessionId: String(formData.get("sessionId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  if (!parsed.success) {
    await recordOpsMutationTrace("operator.session.revoke", "invalid");
    return { kind: "error", error: "Enter a reason between 1 and 500 characters." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsMutationTrace("operator.session.revoke", "denied");
    return { kind: "error", error: refusalText(gate.reason) };
  }
  try {
    const outcome = await opsAction(
      {
        scope: "operator.session.revoke",
        actorId: asUserId(gate.userId),
        targetType: "platform_session",
        targetId: parsed.data.sessionId,
        reason: parsed.data.reason,
        detail: { reason: parsed.data.reason },
      },
      async () =>
        await revokeOperatorSession({
          actorId: gate.userId,
          sessionId: parsed.data.sessionId,
          reason: parsed.data.reason,
        }),
    );
    if (outcome.kind === "applied") revalidatePath("/ops/operators");
    return outcome;
  } catch (error) {
    await recordOpsThrownFailure("operator.session.revoke", error);
    throw error;
  }
}

/** End every live session of one operator. */
export async function revokeAllOperatorSessionsAction(
  _prev: unknown,
  formData: FormData,
): Promise<OperatorActionResult> {
  const parsed = z
    .object({ operatorId: z.string().uuid(), reason: reasonInput })
    .safeParse({
      operatorId: String(formData.get("operatorId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  if (!parsed.success) {
    await recordOpsMutationTrace("operator.session.revoke_all", "invalid");
    return { kind: "error", error: "Enter a reason between 1 and 500 characters." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsMutationTrace("operator.session.revoke_all", "denied");
    return { kind: "error", error: refusalText(gate.reason) };
  }
  try {
    const outcome = await opsAction(
      {
        scope: "operator.session.revoke_all",
        actorId: asUserId(gate.userId),
        targetType: "platform_user",
        targetId: parsed.data.operatorId,
        reason: parsed.data.reason,
        detail: { reason: parsed.data.reason },
      },
      async () =>
        await revokeAllOperatorSessions({
          actorId: gate.userId,
          operatorId: parsed.data.operatorId,
          reason: parsed.data.reason,
        }),
    );
    if (outcome.kind === "applied") revalidatePath("/ops/operators");
    return outcome;
  } catch (error) {
    await recordOpsThrownFailure("operator.session.revoke_all", error);
    throw error;
  }
}

/** Move one operator account between admin and viewer. */
export async function setOperatorRoleAction(
  _prev: unknown,
  formData: FormData,
): Promise<OperatorActionResult> {
  const parsed = z
    .object({
      operatorId: z.string().uuid(),
      role: z.enum(["admin", "viewer"]),
      reason: reasonInput,
    })
    .safeParse({
      operatorId: String(formData.get("operatorId") ?? ""),
      role: String(formData.get("role") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  if (!parsed.success) {
    await recordOpsMutationTrace("operator.role.update", "invalid");
    return { kind: "error", error: "Enter a reason between 1 and 500 characters." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsMutationTrace("operator.role.update", "denied");
    return { kind: "error", error: refusalText(gate.reason) };
  }
  try {
    const outcome = await opsAction(
      {
        scope: "operator.role.update",
        actorId: asUserId(gate.userId),
        targetType: "platform_user",
        targetId: parsed.data.operatorId,
        reason: parsed.data.reason,
        detail: { reason: parsed.data.reason },
      },
      async () =>
        await setOperatorRole({
          actorId: gate.userId,
          operatorId: parsed.data.operatorId,
          role: parsed.data.role,
          reason: parsed.data.reason,
        }),
    );
    if (outcome.kind === "applied") revalidatePath("/ops/operators");
    return outcome;
  } catch (error) {
    await recordOpsThrownFailure("operator.role.update", error);
    throw error;
  }
}

/** Move one operator account between active and suspended. */
export async function setOperatorStatusAction(
  _prev: unknown,
  formData: FormData,
): Promise<OperatorActionResult> {
  const parsed = z
    .object({
      operatorId: z.string().uuid(),
      status: z.enum(["active", "suspended"]),
      reason: reasonInput,
    })
    .safeParse({
      operatorId: String(formData.get("operatorId") ?? ""),
      status: String(formData.get("status") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  if (!parsed.success) {
    await recordOpsMutationTrace("operator.status.update", "invalid");
    return { kind: "error", error: "Enter a reason between 1 and 500 characters." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsMutationTrace("operator.status.update", "denied");
    return { kind: "error", error: refusalText(gate.reason) };
  }
  try {
    const outcome = await opsAction(
      {
        scope: "operator.status.update",
        actorId: asUserId(gate.userId),
        targetType: "platform_user",
        targetId: parsed.data.operatorId,
        reason: parsed.data.reason,
        detail: { reason: parsed.data.reason },
      },
      async () =>
        await setOperatorStatus({
          actorId: gate.userId,
          operatorId: parsed.data.operatorId,
          status: parsed.data.status,
          reason: parsed.data.reason,
        }),
    );
    if (outcome.kind === "applied") revalidatePath("/ops/operators");
    return outcome;
  } catch (error) {
    await recordOpsThrownFailure("operator.status.update", error);
    throw error;
  }
}
