"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  listUpcomingSessions,
  type UpcomingSessionRow,
} from "@/lib/services/coach-schedule";

export type { UpcomingSessionRow } from "@/lib/services/coach-schedule";

// F3 (R.1) — owner/admin view of upcoming sessions. The page
// this serves (`/owner/sessions/page.tsx`) lists every batch's
// upcoming sessions with their current coach, so the substitute
// form on each row can swap the coach in one tap. Parse-then-
// permission preamble; the action is management-only — coaches
// see their own sessions via the existing coach-side surfaces.
//
// R06 (2026-10-13 role-workflow audit) — the gate is programs.write
// (the management scheduling authority), not attendance.read:
// attendance.read is held by coach/reception and must not open the
// tenant-wide scheduling read.

const listSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function listUpcomingSessionsAction(
  raw: unknown,
): Promise<UpcomingSessionRow[]> {
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "programs.write");
  return listUpcomingSessions(ctx, parsed.data.fromDate, parsed.data.toDate);
}
