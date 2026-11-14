"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { reviewClosure, type ClosureReview } from "@/lib/services/closure-review";

export async function reviewClosureAction(holidayId: string): Promise<ClosureReview | null> {
  const parsed = z.string().uuid().safeParse(holidayId);
  if (!parsed.success) return null;
  const ctx = await requireDefaultCtx();
  requirePermission(ctx,"settings.manage");
  return reviewClosure(ctx,parsed.data);
}
