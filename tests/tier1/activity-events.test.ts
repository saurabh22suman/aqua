import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { activityEvents } from "@/db/schema";
import { asTenantId, type TenantId } from "@/lib/ids";
import { createAppScopedBoss } from "@/db/queue";
import {
  ACTIVITY_INGEST_QUEUE,
  runActivityIngestJob,
  type ActivityIngestJobData,
} from "@/lib/jobs/activity-ingest-job";
import { emitActivityEvents } from "@/lib/events/emit";

// E-05 — the activity_events table contract (architecture.md §8.11).
//
// Written before db/migrations/20260918070000_e05_activity_events.sql
// exists: the first run of this file is deliberately red with
// `relation "activity_events" does not exist`. Fixture rows for
// `tenants` (FORCE RLS) go through the privileged migration pool;
// everything the app would do goes through runActivityIngestJob /
// withTenant, so the RLS and grant assertions exercise the real
// access path, not a superuser bypass.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantIds: TenantId[] = [];

async function makeTenant(label: string): Promise<TenantId> {
  const id = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, $3, 'active')",
    [id, `e05-${label}-${RUN}`, `E05 ${label}`],
  );
  tenantIds.push(id);
  return id;
}

function attendanceEvent(
  overrides: Partial<{
    occurredAt: Date;
    clientEventId: string;
    sessionId: string;
    memberId: string;
    status: "present" | "absent" | "late";
  }> = {},
) {
  return {
    eventName: "session.attendance_marked" as const,
    occurredAt: overrides.occurredAt ?? new Date("2026-10-15T04:30:00.000Z"),
    clientEventId: overrides.clientEventId ?? `e05-${uuidv7()}`,
    actorKind: "user" as const,
    entityType: "session",
    entityId: overrides.sessionId ?? uuidv7(),
    properties: {
      sessionId: overrides.sessionId ?? uuidv7(),
      memberId: overrides.memberId ?? uuidv7(),
      status: overrides.status ?? ("present" as const),
    },
    context: {},
    source: "web" as const,
  };
}

beforeAll(async () => {
  // The migration is expected to create 28 monthly partitions; the
  // probes below only need the parent to exist. Nothing to seed here —
  // tenants are created per test so counts are order-independent.
});

afterAll(async () => {
  if (tenantIds.length > 0) {
    await admin.query("delete from activity_events where tenant_id = any($1::uuid[])", [
      tenantIds,
    ]);
    await admin.query("delete from tenants where id = any($1::uuid[])", [tenantIds]);
  }
  await admin.end();
});

describe("E-05 — partitioning", () => {
  it("creates monthly partitions 2026-09 .. 2028-12 with no default partition", async () => {
    const { rows } = await admin.query<{ relname: string; bound: string }>(
      `select c.relname, pg_get_expr(c.relpartbound, c.oid) as bound
         from pg_class c
         join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'activity_events'::regclass
        order by c.relname`,
    );
    expect(rows.length).toBe(28);
    expect(rows.some((r) => r.bound === "DEFAULT")).toBe(false);
    expect(rows.map((r) => r.relname)).toContain("activity_events_2026_09");
    expect(rows.map((r) => r.relname)).toContain("activity_events_2028_12");
  });

  it("routes a 2026-10 event into activity_events_2026_10", async () => {
    const tenantId = await makeTenant("route");
    const clientEventId = `route-${RUN}`;
    const inserted = await runActivityIngestJob(tenantId, [
      attendanceEvent({
        occurredAt: new Date("2026-10-15T04:30:00.000Z"),
        clientEventId,
      }),
    ]);
    expect(inserted).toBe(1);

    const { rows } = await admin.query<{ part: string }>(
      `select tableoid::regclass::text as part
         from activity_events
        where tenant_id = $1 and client_event_id = $2`,
      [tenantId, clientEventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].part).toBe("activity_events_2026_10");
  });

  it("fails loudly on an out-of-horizon insert (no default partition)", async () => {
    const tenantId = await makeTenant("horizon");
    await expect(
      admin.query(
        `insert into activity_events
           (id, tenant_id, occurred_at, event_name, source, client_event_id)
         values ($1, $2, '2029-01-15T00:00:00Z', 'session.attendance_marked', 'job', $3)`,
        [uuidv7(), tenantId, `horizon-${RUN}`],
      ),
    ).rejects.toThrow(/no partition of relation "activity_events" found for row/);
  });
});

describe("E-05 — idempotent ingest", () => {
  it("a duplicate delivery (same client_event_id + occurred_at) inserts exactly one row", async () => {
    const tenantId = await makeTenant("dup");
    const event = attendanceEvent({ clientEventId: `dup-${RUN}` });

    expect(await runActivityIngestJob(tenantId, [event])).toBe(1);
    expect(await runActivityIngestJob(tenantId, [event])).toBe(0);

    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from activity_events
        where tenant_id = $1 and client_event_id = $2`,
      [tenantId, `dup-${RUN}`],
    );
    expect(rows[0].n).toBe(1);
  });

  it("rejects an event_name outside the registry without inserting anything", async () => {
    const tenantId = await makeTenant("unknown");
    const bad = { ...attendanceEvent(), eventName: "session.not_registered" };

    await expect(runActivityIngestJob(tenantId, [bad])).rejects.toThrow();

    const { rows } = await admin.query<{ n: number }>(
      "select count(*)::int as n from activity_events where tenant_id = $1",
      [tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("E-05 — RLS and grants", () => {
  it("another tenant reads zero rows through withTenant()", async () => {
    const tenantA = await makeTenant("rls-a");
    const tenantB = await makeTenant("rls-b");
    await runActivityIngestJob(tenantA, [attendanceEvent()]);

    const countFor = (tenantId: TenantId) =>
      withTenant(tenantId, async (tx) => {
        const rows = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(activityEvents);
        return rows[0].n;
      });

    expect(await countFor(tenantA)).toBe(1);
    expect(await countFor(tenantB)).toBe(0);
  });

  it("app_user can INSERT and SELECT but cannot UPDATE or DELETE", async () => {
    const tenantId = await makeTenant("grants");
    await runActivityIngestJob(tenantId, [attendanceEvent()]);

    // Drizzle wraps driver errors ("Failed query: ...") with the real
    // Postgres error on `.cause` — collect both so the assertion reads
    // the permission failure, not the wrapper.
    async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
      try {
        await promise;
        return "(resolved)";
      } catch (err) {
        const e = err as { message?: string; cause?: { message?: string } };
        return `${e.message ?? ""} | ${e.cause?.message ?? ""}`;
      }
    }

    const updateMessage = await rejectionMessage(
      withTenant(tenantId, (tx) =>
        tx.execute(
          sql`update activity_events set event_name = 'x' where tenant_id = ${tenantId}`,
        ),
      ),
    );
    expect(updateMessage).toMatch(/permission denied for table activity_events/);

    const deleteMessage = await rejectionMessage(
      withTenant(tenantId, (tx) =>
        tx.execute(sql`delete from activity_events where tenant_id = ${tenantId}`),
      ),
    );
    expect(deleteMessage).toMatch(/permission denied for table activity_events/);
  });
});

describe("E-05 — emit enqueues onto the ingest queue", () => {
  it("emitActivityEvents persists a job the worker can fetch", async () => {
    const tenantId = await makeTenant("emit");
    const occurredAt = new Date("2026-11-05T10:00:00.000Z");
    const clientEventId = `emit-${RUN}`;

    await emitActivityEvents(tenantId, [
      attendanceEvent({ occurredAt, clientEventId }),
    ]);

    const boss = createAppScopedBoss();
    await boss.start();
    try {
      const jobs = await boss.fetch<ActivityIngestJobData>(ACTIVITY_INGEST_QUEUE);
      const match = jobs.find((job) => job.data.tenantId === tenantId);
      expect(match).toBeDefined();
      expect(match!.data.events).toHaveLength(1);
      expect(match!.data.events[0]!.eventName).toBe("session.attendance_marked");
      expect(new Date(match!.data.events[0]!.occurredAt).toISOString()).toBe(
        occurredAt.toISOString(),
      );
      await boss.complete(ACTIVITY_INGEST_QUEUE, match!.id);
    } finally {
      await boss.stop({ graceful: false, timeout: 5000 });
    }
  });

  it("emitActivityEvents never throws into the caller's mutation path", async () => {
    const tenantId = await makeTenant("emit-safe");
    // An invalid event is dropped, not thrown — the caller already
    // committed its business transaction by the time emit runs.
    await expect(
      emitActivityEvents(tenantId, [
        { eventName: "not.registered" } as never,
      ]),
    ).resolves.toBeUndefined();
  });
});
