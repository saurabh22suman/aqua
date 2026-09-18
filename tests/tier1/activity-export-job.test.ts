import { afterAll, describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, type TenantId } from "@/lib/ids";
import { runActivityExportJob } from "@/lib/jobs/activity-export-job";
import { ACTIVITY_EXPORT_QUEUE } from "@/lib/jobs/activity-export-schedule";
import { FakeObjectStore } from "../helpers/fake-object-store";

// E-06 (export half) — activity.export writes one gzipped NDJSON
// object per tenant-day at activity-events/<tenantId>/<date>.ndjson.gz.
//
// Written before lib/jobs/activity-export-job.ts exists: the first run
// of this file is deliberately red. Fixture activity_events rows (FORCE
// RLS, partitioned) go through the privileged migration pool, the same
// pattern as tests/tier1/events-rollup-job.test.ts; the job itself runs
// through withTenant. The object store is the in-memory fake.
//
// The plan's "Parquet" export is deliberately realised as NDJSON: a
// Parquet writer is a new dependency this workstream does not add, and
// DuckDB reads NDJSON with read_json_auto — the re-import intent holds.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const TZ = "Asia/Kolkata";
const DAY = "2026-09-15";

const tenantIds: TenantId[] = [];

async function makeTenant(label: string): Promise<TenantId> {
  const id = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', $4)",
    [id, `e06x-${label}-${RUN}`, `E06 export ${label}`, TZ],
  );
  tenantIds.push(id);
  return id;
}

async function insertEvent(
  tenantId: TenantId,
  occurredAt: Date,
  eventName: string,
): Promise<void> {
  await admin.query(
    `insert into activity_events
       (id, tenant_id, occurred_at, event_name, source, client_event_id)
     values ($1, $2, $3, $4, 'job', $5)`,
    [uuidv7(), tenantId, occurredAt, eventName, `e06x-${uuidv7()}`],
  );
}

function exportedLines(store: FakeObjectStore, tenantId: TenantId, date: string) {
  const object = store.objects.get(`activity-events/${tenantId}/${date}.ndjson.gz`);
  expect(object).toBeDefined();
  const text = gunzipSync(Buffer.from(object!.bytes)).toString("utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterAll(async () => {
  if (tenantIds.length > 0) {
    await admin.query("delete from activity_events where tenant_id = any($1::uuid[])", [
      tenantIds,
    ]);
    await admin.query("delete from tenants where id = any($1::uuid[])", [tenantIds]);
  }
  await admin.end();
});

describe("E-06 — activity.export", () => {
  it("exports the tenant-local day as gzipped NDJSON at the tenant-day key", async () => {
    const tenantId = await makeTenant("export");
    await insertEvent(
      tenantId,
      new Date("2026-09-15T04:30:00.000Z"),
      "session.attendance_marked",
    );
    await insertEvent(
      tenantId,
      new Date("2026-09-15T06:15:00.000Z"),
      "session.attendance_corrected",
    );
    // 2026-09-16 04:30Z is day B in IST — must not leak into day A.
    await insertEvent(
      tenantId,
      new Date("2026-09-16T04:30:00.000Z"),
      "session.attendance_marked",
    );

    const store = new FakeObjectStore();
    await runActivityExportJob(tenantId, DAY, { store });

    const object = store.objects.get(`activity-events/${tenantId}/${DAY}.ndjson.gz`);
    expect(object).toBeDefined();
    expect(object!.contentType).toBe("application/gzip");

    const lines = exportedLines(store, tenantId, DAY);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.event_name).sort()).toEqual([
      "session.attendance_corrected",
      "session.attendance_marked",
    ]);
    // The full envelope is exported, not a projection: a re-import must
    // reconstruct the row, not just the event name.
    expect(lines[0]!.tenant_id).toBe(tenantId);
    expect(lines[0]!.client_event_id).toBeTypeOf("string");
    expect(lines[0]!.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is idempotent: a re-run overwrites the same key with identical bytes", async () => {
    const tenantId = await makeTenant("idempotent");
    await insertEvent(
      tenantId,
      new Date("2026-09-15T04:30:00.000Z"),
      "session.attendance_marked",
    );

    const store = new FakeObjectStore();
    await runActivityExportJob(tenantId, DAY, { store });
    const key = `activity-events/${tenantId}/${DAY}.ndjson.gz`;
    const first = store.objects.get(key)!;

    await runActivityExportJob(tenantId, DAY, { store });
    const second = store.objects.get(key)!;

    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    expect(store.putCalls).toBe(2);
    expect([...store.objects.keys()].filter((k) => k === key)).toHaveLength(1);
  });

  it("writes an empty NDJSON object for a day with no events", async () => {
    const tenantId = await makeTenant("empty");
    const store = new FakeObjectStore();

    await runActivityExportJob(tenantId, DAY, { store });

    expect(exportedLines(store, tenantId, DAY)).toEqual([]);
  });

  it("registers the queue name the deploy/worker wiring expects", () => {
    expect(ACTIVITY_EXPORT_QUEUE).toBe("activity.export");
  });
});
