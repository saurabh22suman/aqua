// Mock-only gate access — member gate credentials.
//
// A credential is a PIN a member types at the premises gate or an RFID
// tag they tap at a court. Two rules make this table safe to keep:
//
//   1. The raw secret is never stored. Only the keyed digest from
//      secret.ts reaches the database, and the raw value never reaches
//      a log, an audit row or an error message.
//   2. A credential belongs to a MEMBER, never to a user. The table's
//      foreign key is members(id, tenant_id). A staff login PIN
//      therefore cannot be a gate credential even by accident — there
//      is no row shape for it. That is the structural half of "no
//      staff-PIN shortcut"; the policy half is that a gate only ever
//      opens for a member's own booking or membership.
//
// Every mutation writes its audit row in the same transaction.

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { gateCredentials } from "@/db/schema/mock-access";
import { members } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import { asMemberId } from "@/lib/ids";
import { GATE_FORBIDDEN, gateActorMayManage, type GateActor } from "./actor";
import { gateCredentialFingerprint } from "./secret";

export const issueGateCredentialInput = z.object({
  memberId: z.string().uuid(),
  kind: z.enum(["pin", "rfid"]),
  secret: z.string().trim().min(4).max(128),
  label: z.string().trim().max(120).nullish(),
});

export const revokeGateCredentialInput = z.object({
  credentialId: z.string().uuid(),
});

export type IssueGateCredentialResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string };

export type GateCredentialRow = {
  id: string;
  memberId: string;
  kind: "pin" | "rfid";
  label: string | null;
  status: "active" | "revoked";
};

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid credential.";
}

export async function issueGateCredential(
  actor: GateActor,
  raw: unknown,
): Promise<IssueGateCredentialResult> {
  if (!gateActorMayManage(actor)) return { ok: false, error: GATE_FORBIDDEN };
  const parsed = issueGateCredentialInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  return withTenant(actor.tenantId, async (tx) => {
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

    // The digest is the only representation of the secret that leaves
    // this function.
    const secretHash = gateCredentialFingerprint(
      actor.tenantId,
      input.kind,
      input.secret,
    );

    const [existing] = await tx
      .select({ id: gateCredentials.id })
      .from(gateCredentials)
      .where(
        and(
          eq(gateCredentials.tenantId, actor.tenantId),
          eq(gateCredentials.kind, input.kind),
          eq(gateCredentials.secretHash, secretHash),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        ok: false,
        error: "That card or PIN is already issued in this academy.",
      };
    }

    const [row] = await tx
      .insert(gateCredentials)
      .values({
        tenantId: actor.tenantId,
        memberId: asMemberId(input.memberId),
        kind: input.kind,
        secretHash,
        label: input.label ?? null,
        status: "active",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: gateCredentials.id });
    if (!row) return { ok: false, error: "The credential could not be saved." };

    await writeAudit(tx, {
      tenantId: actor.tenantId,
      actorType: "user",
      actorId: actor.userId,
      requestId: actor.requestId ?? null,
      action: "gate.credential.issue",
      entityType: "gate_credential",
      entityId: row.id,
      after: {
        memberId: input.memberId,
        kind: input.kind,
        label: input.label ?? null,
      },
    });

    return { ok: true, credentialId: row.id };
  });
}

export async function revokeGateCredential(
  actor: GateActor,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!gateActorMayManage(actor)) return { ok: false, error: GATE_FORBIDDEN };
  const parsed = revokeGateCredentialInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  return withTenant(actor.tenantId, async (tx) => {
    const [row] = await tx
      .update(gateCredentials)
      .set({
        status: "revoked",
        updatedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(gateCredentials.id, parsed.data.credentialId),
          eq(gateCredentials.tenantId, actor.tenantId),
          eq(gateCredentials.status, "active"),
        ),
      )
      .returning({ id: gateCredentials.id, memberId: gateCredentials.memberId });
    if (!row) return { ok: false, error: "Credential not found." };

    await writeAudit(tx, {
      tenantId: actor.tenantId,
      actorType: "user",
      actorId: actor.userId,
      requestId: actor.requestId ?? null,
      action: "gate.credential.revoke",
      entityType: "gate_credential",
      entityId: row.id,
      after: { memberId: row.memberId, status: "revoked" },
    });

    return { ok: true };
  });
}

export async function listGateCredentials(
  actor: GateActor,
  memberId: string,
): Promise<GateCredentialRow[]> {
  if (!gateActorMayManage(actor)) return [];
  const parsed = z.string().uuid().safeParse(memberId);
  if (!parsed.success) return [];

  return withTenant(actor.tenantId, (tx) =>
    tx
      .select({
        id: gateCredentials.id,
        memberId: gateCredentials.memberId,
        kind: gateCredentials.kind,
        label: gateCredentials.label,
        status: gateCredentials.status,
      })
      .from(gateCredentials)
      .where(
        and(
          eq(gateCredentials.tenantId, actor.tenantId),
          eq(gateCredentials.memberId, asMemberId(parsed.data)),
        ),
      ),
  );
}
