"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  cancelSession,
  rescheduleSession,
  type SessionLifecycleResult,
} from "@/lib/services/session-lifecycle";

// Phase R.4 — session cancel / reschedule actions. parse-then-
// permission preamble; management-only (the coach can mark
// attendance but doesn't have roster authority to cancel a
// session for the academy).

const idSchema = z.object({ sessionId: z.string().uuid() });

const rescheduleSchema = z.object({
  sessionId: z.string().uuid(),
  newSessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newStartsAt: z.string().datetime({ offset: true }),
  newEndsAt: z.string().datetime({ offset: true }),
});

export async function cancelSessionAction(
  raw: unknown,
): Promise<SessionLifecycleResult> {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "session_not_found", message: "Invalid session id." };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return cancelSession({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed.data.sessionId);
}

export async function rescheduleSessionAction(
  raw: unknown,
): Promise<SessionLifecycleResult> {
  const parsed = rescheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid reschedule request." };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return rescheduleSession(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      sessionId: parsed.data.sessionId,
      newSessionDate: parsed.data.newSessionDate,
      newStartsAt: new Date(parsed.data.newStartsAt),
      newEndsAt: new Date(parsed.data.newEndsAt),
    },
  );
}
