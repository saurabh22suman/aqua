"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  setCurriculumLead,
  type CurriculumLeadResult,
} from "@/lib/services/curriculum-lead";

// R02 (2026-10-13 role-workflow audit) — the owner-controlled
// curriculum-lead designation. Delegation authority is management
// (`settings.manage`); the service re-validates the target (coach
// staff row, live membership, system coach/lead role) and audits the
// role swap in the same transaction. Direct action requests hit the
// same gate — the layout/UI never carries the authority.

const inputSchema = z.object({
  staffId: z.string().uuid(),
  enabled: z.boolean(),
});

export async function setStaffCurriculumLeadAction(
  raw: unknown,
): Promise<CurriculumLeadResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid request." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return setCurriculumLead(ctx, parsed.data.staffId, parsed.data.enabled);
}
