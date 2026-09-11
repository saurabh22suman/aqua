"use server";

// Fixture for tests/scanner-fixtures/server-action-preamble-fixtures.test.ts.
//
// Shape: parse → requireDefaultCtx() → service call → requirePermission().
//
// This is the bug the audit caught: requireDefaultCtx() was in the set of
// "permission-call" names the preamble checker accepts, so the checker
// was satisfied without any actual requirePermission call. A service
// call slipped past it; in production that means a permission check
// runs AFTER a service-level side effect, never BEFORE. The fix removes
// requireDefaultCtx from that set so requireDefaultCtx on its own no
// longer counts as a permission check.
//
// Fixtures must live outside the lib/ and app/ trees the production
// scanner walks, so this file does not ship and does not get scanned.

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";

const inputSchema = z.object({ memberId: z.string().uuid() });

export async function badParseRequireCtxServiceRequirePermAction(
  rawInput: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inputSchema.parse(rawInput);
  const ctx = await requireDefaultCtx();
  // Service call sits BEFORE the permission check — this is the
  // exact ordering the rule is supposed to forbid.
  await doSideEffectingServiceCall(ctx.tenantId, parsed.memberId);
  requirePermission(ctx, "members.read");
  return { ok: true };
}

async function doSideEffectingServiceCall(
  tenantId: string,
  memberId: string,
): Promise<void> {
  // Production-shaped side-effecting service call. Pure fixture; never
  // imported by anything other than the scanner-fixtures test.
  void tenantId;
  void memberId;
}