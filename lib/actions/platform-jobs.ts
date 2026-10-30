"use server";

import { z } from "zod";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import { recordOpsRejection, runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { listDeadLetterJobs } from "@/db/platform-jobs";

// F09 (composed, rev 8) — the audited READ-ONLY surface for the dead-letter
// queue. The manual replay mutation is DEFERRED and is not in this packet:
// no action, export, operation name, ack field or result type for it exists
// here. The read result carries a truthful availability object so the panel
// can explain the limit instead of rendering a dead button.
//
// The action consumes the canonical boundary: runOpsGlobalRead writes one
// `success` operation row per identified caller; recordOpsRejection records
// invalid/denied; requireOpsAdminAction() gates inline.

export type OpsActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type DeadLetterReplayAvailability = {
  available: false;
  reason: string;
};

const DEAD_LETTER_REPLAY_UNAVAILABLE: DeadLetterReplayAvailability = {
  available: false,
  reason:
    "Manual dead-letter replay is not available in this release. It is deferred pending a " +
    "separate approval of a safe, idempotent replay design. The dead-letter list is read-only.",
};

const listInput = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

function refusalText(reason: "unauthenticated" | "forbidden"): string {
  return reason === "forbidden"
    ? "Your platform account has read-only access."
    : "Your session has expired. Sign in again.";
}

export async function listDeadLetterJobsAction(
  _prev: unknown,
  formData: FormData,
): Promise<
  OpsActionResult<{
    jobs: Awaited<ReturnType<typeof listDeadLetterJobs>>;
    replay: DeadLetterReplayAvailability;
  }>
> {
  const parsed = listInput.safeParse({ limit: String(formData.get("limit") ?? "").trim() || 50 });
  if (!parsed.success) {
    await recordOpsRejection("job.dead_letter.list", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("job.dead_letter.list", "denied");
    return { ok: false, error: refusalText(gate.reason) };
  }
  const result = await runOpsGlobalRead("job.dead_letter.list", async () => ({
    ok: true as const,
    value: {
      jobs: await listDeadLetterJobs(parsed.data.limit),
      replay: DEAD_LETTER_REPLAY_UNAVAILABLE,
    },
  }));
  if (result === null) return { ok: false, error: "Your session has expired. Sign in again." };
  return result;
}
