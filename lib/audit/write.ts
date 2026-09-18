import { auditLog, type AuditActorType, type AuditSource } from "@/db/schema/audit";
import type { TenantTx } from "@/db/tenant";
import type { TenantId, UserId } from "@/lib/ids";

// E-01 — the one audit writer. Every tenant-side mutation goes
// through this helper so the actor model (actor_type, nullable
// actor_id, source, changed_fields, request_id) is applied in one
// place instead of thirteen inline inserts drifting apart again.
//
// Established callers may keep their inline inserts — actor_type and
// source default to the values those inserts implied ('user', 'web').
// New call sites, and every caller that has a Ctx, should use this.

export type AuditWriteInput = {
  tenantId: TenantId;
  actorType?: AuditActorType;
  actorId?: UserId | string | null;
  impersonatorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  changedFields?: string[] | null;
  ip?: string | null;
  source?: AuditSource;
  requestId?: string | null;
};

export async function writeAudit(
  tx: TenantTx,
  input: AuditWriteInput,
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: input.tenantId,
    actorType: input.actorType ?? "user",
    actorId: (input.actorId ?? null) as UserId | null,
    impersonatorId: input.impersonatorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    changedFields: input.changedFields ?? null,
    ip: input.ip ?? null,
    source: input.source ?? "web",
    requestId: input.requestId ?? null,
  });
}
