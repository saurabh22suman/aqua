"use server";

// Fixture for tests/scanner-fixtures/server-action-preamble-fixtures.test.ts.
//
// Shape: parse → requirePermission(ctx, "x.y") → service call.
//
// The correct order the preamble rule enforces. requirePermission runs
// against the resolved ctx before any service-level side effect. The
// fixture must pass the checker after the fix lands.
//
// Fixtures must live outside the lib/ and app/ trees the production
// scanner walks, so this file does not ship and does not get scanned.

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";

const inputSchema = z.object({ memberId: z.string().uuid() });

export async function goodParseRequirePermServiceAction(
  rawInput: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inputSchema.parse(rawInput);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  await doSideEffectingServiceCall(ctx.tenantId, parsed.memberId);
  return { ok: true };
}

async function doSideEffectingServiceCall(
  tenantId: string,
  memberId: string,
): Promise<void> {
  void tenantId;
  void memberId;
}