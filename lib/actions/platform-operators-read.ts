"use server";

import { z } from "zod";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import { recordOpsRejection, runOpsGlobalRead } from "@/lib/auth/ops-operation";
import {
  listOperatorAccounts,
  listOperatorSessions,
  OPERATOR_LIST_LIMIT,
  OPERATOR_SESSION_LIMIT,
  type OperatorAccountList,
  type OperatorSessionList,
} from "@/db/platform-operators-read";

export type OpsOperatorResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function refusalText(reason: "unauthenticated" | "forbidden"): string {
  return reason === "forbidden"
    ? "Your platform account has read-only access."
    : "Your session has expired. Sign in again.";
}

const accountsInput = z.object({
  limit: z.coerce.number().int().min(1).max(OPERATOR_LIST_LIMIT).default(OPERATOR_LIST_LIMIT),
});

/** The operator accounts, bounded, for an administrator. */
export async function listOperatorAccountsAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsOperatorResult<OperatorAccountList>> {
  const parsed = accountsInput.safeParse({
    limit: String(formData.get("limit") ?? "").trim() || OPERATOR_LIST_LIMIT,
  });
  if (!parsed.success) {
    await recordOpsRejection("operator.list", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("operator.list", "denied");
    return { ok: false, error: refusalText(gate.reason) };
  }
  const result = await runOpsGlobalRead("operator.list", async () => ({
    ok: true as const,
    value: await listOperatorAccounts(parsed.data.limit),
  }));
  if (result === null) return { ok: false, error: "Your session has expired. Sign in again." };
  return result;
}

const sessionsInput = z.object({
  operatorIds: z.array(z.string().uuid()).max(OPERATOR_LIST_LIMIT).default([]),
  limit: z.coerce.number().int().min(1).max(OPERATOR_SESSION_LIMIT).default(OPERATOR_SESSION_LIMIT),
});

/** The operator sessions, bounded across the named operators. */
export async function listOperatorSessionsAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsOperatorResult<OperatorSessionList>> {
  const parsed = sessionsInput.safeParse({
    operatorIds: formData.getAll("operatorId").map((value) => String(value)),
    limit: String(formData.get("limit") ?? "").trim() || OPERATOR_SESSION_LIMIT,
  });
  if (!parsed.success) {
    await recordOpsRejection("operator.session.list", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("operator.session.list", "denied");
    return { ok: false, error: refusalText(gate.reason) };
  }
  const result = await runOpsGlobalRead("operator.session.list", async () => ({
    ok: true as const,
    value: await listOperatorSessions(parsed.data.operatorIds, parsed.data.limit),
  }));
  if (result === null) return { ok: false, error: "Your session has expired. Sign in again." };
  return result;
}
