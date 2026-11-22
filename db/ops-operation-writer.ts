import { z } from "zod";
import { db } from "./client";
import { withPlatform } from "./scope";
import { platformAuditLog } from "./schema/platform-users";
import type {
  OpsAuditOrigin,
  OpsBoundaryOperation,
  OpsBoundaryOutcome,
} from "@/lib/auth/ops-operation";
import { asTenantId, asUserId } from "@/lib/ids";

// Internal primitive; the server entry boundary supplies the verified actor.
export async function appendOpsBoundaryEvent(
  operation: OpsBoundaryOperation,
  outcome: OpsBoundaryOutcome,
  actorId: string,
  correlationId: string,
  tenantId: string | undefined,
  origin: OpsAuditOrigin,
): Promise<void> {
  const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
  const safeActor = asUserId(uuidSchema.parse(actorId));
  const safeTenant = tenantId === undefined ? null : asTenantId(uuidSchema.parse(tenantId));
  await withPlatform(() => db.transaction(async (tx) => {
    await tx.insert(platformAuditLog).values({
      actorId: safeActor,
      tenantId: safeTenant,
      action: `ops.operation.${operation}`,
      detail: { outcome, correlationId, origin },
    });
  }));
}
