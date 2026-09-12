"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  addMemberFacility,
  endMemberFacility,
  listOptedFacilities,
  type OptedFacilityRow,
} from "@/lib/services/facility-optins";

// Wave 2 — member facility opt-ins. Parse-then-permission preamble on
// every action (AGENTS.md absolute rule); members.write gates the
// mutations, members.read the list.

const memberIdSchema = z.string().uuid();

const addSchema = z.object({
  memberId: z.string().uuid(),
  locationId: z.string().uuid(),
  optedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const endSchema = z.object({
  optinId: z.string().uuid(),
  endedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function listOptedFacilitiesAction(
  rawMemberId: string,
): Promise<OptedFacilityRow[]> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return listOptedFacilities(ctx, memberId);
}

export async function addMemberFacilityAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  const result = await addMemberFacility(ctx, parsed.data);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function endMemberFacilityAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = endSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  const result = await endMemberFacility(ctx, parsed.data);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
