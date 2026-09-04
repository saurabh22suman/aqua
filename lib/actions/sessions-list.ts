"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
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
  assertManagement(ctx);
  return listUpcomingSessions(ctx, parsed.data.fromDate, parsed.data.toDate);
}
