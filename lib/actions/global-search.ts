"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  globalSearch,
  type GlobalSearchHit,
} from "@/lib/services/global-search";

// U-05 — global search action. `members.read` is the coarse gate: it
// is the baseline staff read that owner / admin / accountant /
// receptionist all carry, and the search box lives on the owner
// shell (U-10). Per-kind reads are then resolved from ctx.permissions
// inside the service (enquiries.read, invoices.read), so a caller
// never receives a kind they are not entitled to. A coach carries
// none of the three keys: the coarse gate refuses before any query.
const globalSearchQuerySchema = z.string().trim().min(2).max(80);

export async function globalSearchAction(
  raw: string,
): Promise<GlobalSearchHit[]> {
  const query = globalSearchQuerySchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return globalSearch(
    {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      roleKey: ctx.roleKey,
      permissions: ctx.permissions,
    },
    query,
  );
}
