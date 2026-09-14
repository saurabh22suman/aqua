import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "./tenant";
import { withPlatformAdmin } from "./scope";
import {
  configChangeRequests,
  configKeys,
  type ConfigChangeRequest,
} from "./schema/config";
import { tenants } from "./schema/tenants";
import { auditLog } from "./schema/audit";
import { recordOpsAudit } from "./ops-action";
import type { TenantId, UserId } from "@/lib/ids";

// O-07 (docs/ops-platform-design.md §4) — the "Request change" path for
// owner_read keys. A request is a tenant's ask (tenant-scoped, RLS);
// the resolution is an ops decision (platform_admin) audited through
// the O-05 pipeline.

export type ConfigChangeRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

export async function requestConfigChange(
  ctx: { tenantId: TenantId; userId?: UserId },
  input: { key: string; requestedValue: string; note?: string },
): Promise<ConfigChangeRequestResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const keyRows = await tx
      .select({ visibility: configKeys.visibility })
      .from(configKeys)
      .where(eq(configKeys.key, input.key))
      .limit(1);
    const keyRow = keyRows[0];
    if (!keyRow) {
      return { ok: false, error: "Unknown configuration key." };
    }
    if (keyRow.visibility !== "owner_read") {
      return {
        ok: false,
        error:
          keyRow.visibility === "owner_edit"
            ? "This setting can be changed directly."
            : "This setting is not owner-visible.",
      };
    }

    const [row] = await tx
      .insert(configChangeRequests)
      .values({
        tenantId: ctx.tenantId,
        key: input.key,
        requestedValue: input.requestedValue,
        note: input.note ?? null,
        status: "requested",
        requestedBy: ctx.userId ?? null,
      })
      .returning({ id: configChangeRequests.id });
    if (!row) {
      return { ok: false, error: "The request could not be saved." };
    }

    if (ctx.userId) {
      await tx.insert(auditLog).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "config.request",
        entityType: "config_change_request",
        entityId: row.id,
        after: {
          key: input.key,
          requestedValue: input.requestedValue,
          note: input.note ?? null,
        },
      });
    }

    return { ok: true, requestId: row.id };
  });
}

export type ConfigChangeRequestRow = ConfigChangeRequest & {
  tenantName: string;
};

export async function listConfigChangeRequests(
  tenantId?: TenantId,
): Promise<ConfigChangeRequestRow[]> {
  return withPlatformAdmin(async (tx) => {
    const conditions = tenantId
      ? [eq(configChangeRequests.tenantId, tenantId)]
      : [];
    const rows = await tx
      .select({
        request: configChangeRequests,
        tenantName: tenants.name,
      })
      .from(configChangeRequests)
      .innerJoin(tenants, eq(tenants.id, configChangeRequests.tenantId))
      .where(and(...conditions))
      .orderBy(
        // Pending first, then newest.
        desc(sql`${configChangeRequests.status} = 'requested'`),
        desc(configChangeRequests.createdAt),
      );
    return rows.map((row) => ({ ...row.request, tenantName: row.tenantName }));
  });
}

export async function resolveConfigChangeRequest(
  params: {
    requestId: string;
    status: "resolved" | "declined";
    resolutionNote?: string;
    actorId: UserId;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withPlatformAdmin(async (tx) => {
    const rows = await tx
      .select()
      .from(configChangeRequests)
      .where(eq(configChangeRequests.id, params.requestId))
      .limit(1);
    const request = rows[0];
    if (!request) {
      return { ok: false, error: "Request not found." };
    }
    if (request.status !== "requested") {
      return { ok: false, error: "This request has already been decided." };
    }

    const now = new Date();
    await tx
      .update(configChangeRequests)
      .set({
        status: params.status,
        resolutionNote: params.resolutionNote ?? null,
        resolvedBy: params.actorId,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(configChangeRequests.id, params.requestId),
          eq(configChangeRequests.status, "requested"),
        ),
      );

    await recordOpsAudit(tx, {
      action: "config.request.resolve",
      actorId: params.actorId,
      tenantId: request.tenantId,
      targetType: "config_change_request",
      targetId: params.requestId,
      before: { status: request.status },
      after: { status: params.status },
      detail: {
        key: request.key,
        resolutionNote: params.resolutionNote ?? null,
      },
    });

    return { ok: true };
  });
}
