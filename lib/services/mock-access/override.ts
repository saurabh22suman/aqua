// Mock-only gate access — the manual override.
//
// Sometimes a member is standing at the gate and the policy says no
// for a reason nobody wants to argue about at the door. An
// authorised staff member can let them in — but never silently: the
// override needs a written reason, it is attributed to the staff
// member who made it, and it is written to the access log AND the
// audit trail in the same transaction, so a granted access with no
// reason behind it cannot exist.
//
// Authority is settings.manage (owner / administrator). The desk roles
// do not carry it.

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { gateAccessEvents } from "@/db/schema/mock-access";
import { members } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import { asMemberId } from "@/lib/ids";
import { GATE_FORBIDDEN, gateActorMayManage, type GateActor } from "./actor";
import { deviceByKeyInTx } from "./devices";

export const overrideGateAccessInput = z.object({
  deviceKey: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  memberId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  clientEventId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
});

export type OverrideGateAccessResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid override.";
}

export async function overrideGateAccess(
  actor: GateActor,
  raw: unknown,
): Promise<OverrideGateAccessResult> {
  if (!gateActorMayManage(actor)) return { ok: false, error: GATE_FORBIDDEN };
  const parsed = overrideGateAccessInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  const clientEventId = input.clientEventId ?? `override-${uuidv7()}`;

  return withTenant(actor.tenantId, async (tx) => {
    const device = await deviceByKeyInTx(tx, actor.tenantId, input.deviceKey);
    if (!device) return { ok: false, error: "Gate not found." };

    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.id, asMemberId(input.memberId)),
          eq(members.tenantId, actor.tenantId),
          isNull(members.deletedAt),
        ),
      )
      .limit(1);
    if (!member) return { ok: false, error: "Member not found." };

    // An event id already used at this gate is that event — the
    // override is idempotent on it, and a scan that already owns the
    // id is not silently converted into an override.
    const priorRows = await tx
      .select({
        id: gateAccessEvents.id,
        reasonCode: gateAccessEvents.reasonCode,
      })
      .from(gateAccessEvents)
      .where(
        and(
          eq(gateAccessEvents.tenantId, actor.tenantId),
          eq(gateAccessEvents.deviceId, device.id),
          eq(gateAccessEvents.clientEventId, clientEventId),
        ),
      )
      .limit(1);
    const prior = priorRows[0];
    if (prior) {
      if (prior.reasonCode === "granted_manual_override") {
        return { ok: true, eventId: prior.id };
      }
      return {
        ok: false,
        error: "That access event has already been recorded.",
      };
    }

    const [row] = await tx
      .insert(gateAccessEvents)
      .values({
        tenantId: actor.tenantId,
        deviceId: device.id,
        memberId: asMemberId(input.memberId),
        credentialId: null,
        credentialFingerprint: null,
        method: "override",
        decision: "granted",
        reasonCode: "granted_manual_override",
        basis: "override",
        overrideReason: input.reason,
        decidedBy: actor.userId,
        occurredAt: new Date(),
        clientEventId,
      })
      .returning({ id: gateAccessEvents.id });
    if (!row) return { ok: false, error: "The override could not be recorded." };

    // The audit row and the access row are one transaction: an
    // override that cannot be audited does not happen. (Proven by
    // tests/mock-access/gate-override.test.ts — moving this write to
    // its own transaction turns that test red.)
    await writeAudit(tx, {
      tenantId: actor.tenantId,
      actorType: "user",
      actorId: actor.userId,
      requestId: actor.requestId ?? null,
      action: "gate.access.override",
      entityType: "gate_access_event",
      entityId: row.id,
      after: {
        deviceKey: input.deviceKey,
        memberId: input.memberId,
        reason: input.reason,
        reasonCode: "granted_manual_override",
      },
    });

    return { ok: true, eventId: row.id };
  });
}
