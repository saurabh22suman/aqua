import { gzipSync } from "node:zlib";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { activityEvents, type ActivityEventRow } from "@/db/schema/activity-events";
import { canonicalJsonStringify } from "@/lib/canonical-json";
import { getObjectStore, type ObjectStore } from "@/lib/storage/object-store";
import { addDays, dayRangeUtc, todayInZone } from "@/lib/time/tz";
import type { TenantId } from "@/lib/ids";

// E-06 (export half) — activity.export. Writes one gzipped NDJSON
// object per tenant-local day at
// activity-events/<tenantId>/<date>.ndjson.gz.
//
// DEVIATION FROM THE PLAN — the plan says Parquet; this writes NDJSON
// (newline-delimited JSON, gzip-compressed). A Parquet writer is a new
// dependency this workstream does not add, and the plan's own intent —
// "the export re-imports in DuckDB" — holds exactly: DuckDB reads the
// object with `read_json_auto('s3://…/activity-events/<tenant>/<date>.ndjson.gz')`,
// including the nested properties/context columns. If Parquet is
// wanted later, it is a writer swap behind this same key-day layout,
// not a change to the retention path.
//
// Idempotency: the key is deterministic and putObject overwrites it, so
// a retry after a crash writes the same bytes for the same day. Rows
// are ordered by (occurred_at, id) and serialised with the shared
// canonical JSON helper (sorted keys, ISO timestamps), so the object is
// byte-stable across runs on unchanged data.
//
// The export is per tenant-day, not per partition: partitions are a
// storage detail, tenant-days are what retention verifies before it
// drops a partition. An empty day still produces a (tiny) object so the
// day-count is complete.
//
// `deps` exists for tests: inject the in-memory fake store instead of
// the R2-configured one.

export type ActivityExportDeps = {
  store?: ObjectStore;
};

export function activityExportObjectKey(tenantId: string, date: string): string {
  return `activity-events/${tenantId}/${date}.ndjson.gz`;
}

// Explicit snake_case projection: the export is a data interchange
// artifact (DuckDB, an analyst's DataFrame), so it carries the database
// column names rather than the TypeScript property names.
function exportLine(row: ActivityEventRow): Record<string, unknown> {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    occurred_at: row.occurredAt,
    received_at: row.receivedAt,
    actor_id: row.actorId,
    actor_kind: row.actorKind,
    session_id: row.sessionId,
    request_id: row.requestId,
    event_name: row.eventName,
    entity_type: row.entityType,
    entity_id: row.entityId,
    properties: row.properties,
    context: row.context,
    source: row.source,
    client_event_id: row.clientEventId,
  };
}

export async function runActivityExportJob(
  tenantId: TenantId,
  onDate?: string,
  deps: ActivityExportDeps = {},
): Promise<void> {
  const store = deps.store ?? getObjectStore();

  const exported = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ status: tenants.status, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
      return null;
    }

    const date = onDate ?? addDays(todayInZone(tenant.timezone), -1);
    const { fromUtc, toUtc } = dayRangeUtc(date, tenant.timezone);

    const rows = await tx
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tenantId, tenantId),
          gte(activityEvents.occurredAt, fromUtc),
          lt(activityEvents.occurredAt, toUtc),
        ),
      )
      .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id));

    const ndjson =
      rows.map((row) => canonicalJsonStringify(exportLine(row))).join("\n") +
      (rows.length > 0 ? "\n" : "");
    const bytes = gzipSync(Buffer.from(ndjson, "utf8"));
    return { date, rowCount: rows.length, bytes };
  });

  if (!exported) return;

  await store.putObject(
    activityExportObjectKey(tenantId, exported.date),
    exported.bytes,
    "application/gzip",
  );

  console.log(
    `[activity.export] tenant ${tenantId} ${exported.date}: ` +
      `${exported.rowCount} row(s), ` +
      `${activityExportObjectKey(tenantId, exported.date)}`,
  );
}
