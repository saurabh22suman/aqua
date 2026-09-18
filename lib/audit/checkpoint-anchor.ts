import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { platformAuditLog } from "@/db/schema/platform-users";
import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";

// E-03 — the always-available audit checkpoint anchor.
//
// platform_audit_log is outside RLS and insert-granted to the app role,
// so the aggregate digest survives even when the object store is down
// or disabled. The job writes one row per tenant-day (action
// `audit.checkpoint`, detail {date, rowCount, digest}); the verifier
// falls back to the latest row for a tenant-day when no manifest can be
// read. The detail is external JSON, so it is validated on read like
// any other boundary payload.

export const AUDIT_CHECKPOINT_ACTION = "audit.checkpoint";

const anchorSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rowCount: z.number().int().nonnegative(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type CheckpointAnchor = z.infer<typeof anchorSchema>;

// Latest row wins: the job only inserts a second anchor when the
// recomputed digest differs from the stored one (late-committing rows),
// and the annotation of which anchor is current is created_at order.
export async function selectCheckpointAnchor(
  tx: TenantTx,
  tenantId: TenantId,
  date: string,
): Promise<CheckpointAnchor | null> {
  const [row] = await tx
    .select({ detail: platformAuditLog.detail })
    .from(platformAuditLog)
    .where(
      and(
        eq(platformAuditLog.tenantId, tenantId),
        eq(platformAuditLog.action, AUDIT_CHECKPOINT_ACTION),
        sql`${platformAuditLog.detail}->>'date' = ${date}`,
      ),
    )
    .orderBy(desc(platformAuditLog.createdAt))
    .limit(1);
  if (!row) return null;
  const parsed = anchorSchema.safeParse(row.detail);
  if (!parsed.success) {
    throw new Error(
      `audit.checkpoint anchor for ${tenantId}/${date} failed validation: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
