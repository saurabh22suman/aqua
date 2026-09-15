import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "./tenant";
import { auditLog } from "./schema/audit";
import { listPlatformActivity } from "./platform-activity";
import type { ConfigKeyName } from "./config-definitions";
import type { TenantId } from "@/lib/ids";

// PR5 (ops console improvements) — the configuration audit log,
// scoped to one tenant and one key. Config changes land in two
// different tables depending on who made them: owner edits and
// config.request rows go to the tenant-scoped audit_log; ops platform-
// side writes and change-request resolutions go to platform_audit_log
// (db/config.ts, db/config-requests.ts). Both are read and merged here
// so "who changed this and when" is a complete answer, not just half
// of one.

export type TenantConfigAuditEntry = {
  id: string;
  action: string;
  actorLabel: "Owner" | "Ops";
  createdAt: Date;
  before: unknown;
  after: unknown;
};

const OWNER_ACTIONS = ["config.set", "config.request"] as const;
const OPS_ACTIONS = ["config.set", "config.request.resolve"] as const;

export async function getTenantConfigAuditLog(
  tenantId: TenantId,
  key: ConfigKeyName,
  limit = 50,
): Promise<TenantConfigAuditEntry[]> {
  const ownerRows = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantId),
          sql`${auditLog.action} in (${sql.join(
            OWNER_ACTIONS.map((a) => sql`${a}`),
            sql`, `,
          )})`,
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(200);
    return rows.filter((r) => {
      const after = r.after as Record<string, unknown> | null;
      return after?.key === key;
    });
  });

  const activity = await listPlatformActivity({ tenantId, limit: 200 });
  const opsRows = activity.rows.filter(
    (r) =>
      (OPS_ACTIONS as readonly string[]).includes(r.action) &&
      r.detail?.key === key,
  );

  const merged: TenantConfigAuditEntry[] = [
    ...ownerRows.map((r) => ({
      id: `owner-${r.id}`,
      action: r.action,
      actorLabel: "Owner" as const,
      createdAt: r.createdAt,
      before: r.before,
      after: r.after,
    })),
    ...opsRows.map((r) => ({
      id: `ops-${r.id}`,
      action: r.action,
      actorLabel: "Ops" as const,
      createdAt: r.createdAt,
      before: null,
      after: r.detail,
    })),
  ];

  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return merged.slice(0, limit);
}
