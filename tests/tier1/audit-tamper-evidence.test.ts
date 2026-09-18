import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { asTenantId, type TenantId } from "@/lib/ids";
import { dayRangeUtc } from "@/lib/time/tz";
import {
  buildCheckpointManifest,
  digestAuditRows,
  selectAuditRowsForDay,
  verifyCheckpoint,
  type AuditCheckpointRow,
} from "@/lib/audit/checkpoint";
import { runAuditCheckpointJob } from "@/lib/jobs/audit-checkpoint-job";
import { AUDIT_CHECKPOINT_QUEUE } from "@/lib/jobs/audit-checkpoint-schedule";
import { deleteAuditRows } from "../helpers/audit-log-cleanup";
import { FakeObjectStore } from "../helpers/fake-object-store";

// E-03 — audit tamper evidence.
//
// Written before db/migrations/20260918095000_e03_audit_guard.sql and
// lib/audit/checkpoint.ts exist: the first run of this file is
// deliberately red. The contract under test:
//
//   1. audit_log refuses UPDATE and DELETE for every role, including
//      the privileged migration pool (a trigger does not care about
//      BYPASSRLS).
//   2. The checkpoint digest is canonical (stable key ordering, fixed
//      timestamp format) and changes when any row changes.
//   3. The nightly job writes a deterministic manifest to the object
//      store and an always-available anchor row to platform_audit_log,
//      idempotently.
//   4. The verifier exits non-zero after a hand-edited row — the tamper
//      is simulated by disabling the trigger with the admin pool, which
//      is what an operator with DB access would have to do.
//
// Fixture rows for tenants/audit_log (both FORCE RLS) go through the
// privileged migration pool; the job's own reads run through
// withTenant. The object store is the in-memory fake.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const TZ = "Asia/Kolkata";
const DAY = "2026-09-15";
const SECRET = "test-checkpoint-secret";

const tenantIds: TenantId[] = [];

async function makeTenant(label: string): Promise<TenantId> {
  const id = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', $4)",
    [id, `e03-${label}-${RUN}`, `E03 ${label}`, TZ],
  );
  tenantIds.push(id);
  return id;
}

async function insertAuditRow(
  tenantId: TenantId,
  overrides: {
    action?: string;
    before?: unknown;
    after?: unknown;
    createdAt?: Date;
  } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into audit_log
       (tenant_id, actor_type, actor_id, action, entity_type, entity_id,
        before, after, source, created_at)
     values ($1, 'job', null, $2, 'member', null,
             $3::jsonb, $4::jsonb, 'job', $5)
     returning id`,
    [
      tenantId,
      overrides.action ?? "member.update",
      JSON.stringify(overrides.before ?? null),
      JSON.stringify(overrides.after ?? null),
      overrides.createdAt ?? new Date("2026-09-15T05:00:00.000Z"),
    ],
  );
  return rows[0]!.id;
}

// The tamper simulation needs the trigger disabled for an UPDATE (the
// shared cleanup helper only handles DELETE). Red runs (before the
// migration exists) have no trigger to disable.
async function withoutMutationGuard(fn: () => Promise<void>): Promise<void> {
  const { rows } = await admin.query(
    "select 1 from pg_trigger where tgname = 'audit_log_no_mutate'",
  );
  const hasTrigger = rows.length > 0;
  if (hasTrigger) {
    await admin.query("alter table audit_log disable trigger audit_log_no_mutate");
  }
  try {
    await fn();
  } finally {
    if (hasTrigger) {
      await admin.query("alter table audit_log enable trigger audit_log_no_mutate");
    }
  }
}

function auditRow(
  overrides: Partial<AuditCheckpointRow> = {},
): AuditCheckpointRow {
  return {
    id: "1",
    tenantId: "00000000-0000-0000-0000-000000000000",
    actorType: "job",
    actorId: null,
    impersonatorId: null,
    action: "member.update",
    entityType: "member",
    entityId: null,
    before: null,
    after: null,
    changedFields: null,
    ip: null,
    source: "job",
    requestId: null,
    createdAt: new Date("2026-09-15T05:00:00.000Z"),
    ...overrides,
  };
}

afterAll(async () => {
  if (tenantIds.length > 0) {
    await deleteAuditRows(admin, "tenant_id = any($1::uuid[])", [tenantIds]);
    await admin.query(
      "delete from platform_audit_log where tenant_id = any($1::uuid[]) and action = 'audit.checkpoint'",
      [tenantIds],
    );
    await admin.query("delete from tenants where id = any($1::uuid[])", [tenantIds]);
  }
  await admin.end();
});

describe("E-03 — audit_log append-only guard", () => {
  it("blocks UPDATE even for the privileged pool", async () => {
    const tenantId = await makeTenant("guard-update");
    const id = await insertAuditRow(tenantId);

    await expect(
      admin.query("update audit_log set action = 'tampered' where id = $1", [id]),
    ).rejects.toThrow(/audit_log is append-only/);

    const { rows } = await admin.query<{ action: string }>(
      "select action from audit_log where id = $1",
      [id],
    );
    expect(rows[0]!.action).toBe("member.update");
  });

  it("blocks DELETE even for the privileged pool", async () => {
    const tenantId = await makeTenant("guard-delete");
    await insertAuditRow(tenantId);

    await expect(
      admin.query("delete from audit_log where tenant_id = $1", [tenantId]),
    ).rejects.toThrow(/audit_log is append-only/);
  });

  it("is created on the plain table, not by naming a partition", async () => {
    const { rows } = await admin.query<{ tgrelid: string }>(
      `select tgrelid::regclass::text as tgrelid
         from pg_trigger
        where tgname = 'audit_log_no_mutate'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tgrelid).toBe("audit_log");
  });
});

describe("E-03 — canonical digest", () => {
  it("is stable across two computations and across JSON key ordering", () => {
    const rows = [auditRow({ before: { b: 1, a: { d: 2, c: 3 } } })];
    const reordered = [auditRow({ before: { a: { c: 3, d: 2 }, b: 1 } })];

    const first = digestAuditRows(rows, SECRET);
    const second = digestAuditRows(rows, SECRET);
    const third = digestAuditRows(reordered, SECRET);

    expect(second.digest).toBe(first.digest);
    expect(third.digest).toBe(first.digest);
    expect(second.rowCount).toBe(1);
  });

  it("changes when a row changes and when a row is dropped", () => {
    const original = digestAuditRows([auditRow()], SECRET).digest;
    const changed = digestAuditRows(
      [auditRow({ action: "member.delete" })],
      SECRET,
    ).digest;
    const dropped = digestAuditRows([], SECRET).digest;

    expect(changed).not.toBe(original);
    expect(dropped).not.toBe(original);
  });

  it("uses a fixed timestamp format, so Date and ISO-string inputs agree", () => {
    const asDate = digestAuditRows([auditRow()], SECRET).digest;
    const asString = digestAuditRows(
      [auditRow({ createdAt: "2026-09-15T05:00:00.000Z" })],
      SECRET,
    ).digest;
    expect(asString).toBe(asDate);
  });

  it("verifyCheckpoint reports the first divergent row id", () => {
    const rows = [auditRow({ id: "1" }), auditRow({ id: "2" }), auditRow({ id: "3" })];
    const manifest = buildCheckpointManifest(
      "00000000-0000-0000-0000-000000000000",
      DAY,
      rows,
      SECRET,
    );

    expect(verifyCheckpoint(manifest, rows, SECRET).ok).toBe(true);

    const tampered = [rows[0]!, { ...rows[1]!, action: "tampered.action" }, rows[2]!];
    const result = verifyCheckpoint(manifest, tampered, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstDivergentRowId).toBe("2");
    }
  });
});

describe("E-03 — audit.checkpoint job", () => {
  it("writes a deterministic manifest and one anchor row per tenant-day", async () => {
    const tenantId = await makeTenant("checkpoint");
    await insertAuditRow(tenantId, {
      createdAt: new Date("2026-09-15T05:00:00.000Z"),
    });
    await insertAuditRow(tenantId, {
      action: "member.create",
      createdAt: new Date("2026-09-15T06:30:00.000Z"),
    });
    // The next tenant-local day must not leak into this day's digest.
    await insertAuditRow(tenantId, {
      createdAt: new Date("2026-09-15T20:00:00.000Z"),
    });

    const store = new FakeObjectStore();
    await runAuditCheckpointJob(tenantId, DAY, { store, secret: SECRET });

    const key = `audit-checkpoints/${tenantId}/${DAY}.json`;
    const first = store.objects.get(key);
    expect(first).toBeDefined();

    await runAuditCheckpointJob(tenantId, DAY, { store, secret: SECRET });
    const second = store.objects.get(key);
    expect(Buffer.from(second!.bytes).equals(Buffer.from(first!.bytes))).toBe(true);

    const manifest = JSON.parse(Buffer.from(first!.bytes).toString("utf8")) as {
      tenantId: string;
      date: string;
      rowCount: number;
      digest: string;
      rows: Array<{ id: string; hash: string }>;
    };
    expect(manifest.tenantId).toBe(tenantId);
    expect(manifest.date).toBe(DAY);
    expect(manifest.rowCount).toBe(2);
    expect(manifest.rows).toHaveLength(2);

    const anchors = await admin.query<{ detail: { date: string; rowCount: number; digest: string } }>(
      `select detail from platform_audit_log
        where tenant_id = $1 and action = 'audit.checkpoint'
        order by created_at desc`,
      [tenantId],
    );
    expect(anchors.rows).toHaveLength(1);
    expect(anchors.rows[0]!.detail).toEqual({
      date: DAY,
      rowCount: 2,
      digest: manifest.digest,
    });
  });

  it("registers the queue name the deploy/worker wiring expects", () => {
    expect(AUDIT_CHECKPOINT_QUEUE).toBe("audit.checkpoint");
  });
});

describe("E-03 — verifier detects a hand-edited row", () => {
  it("exits 0 on an untouched day and non-zero after a tampered row", async () => {
    const tenantId = await makeTenant("verify");
    const tamperedId = await insertAuditRow(tenantId, {
      createdAt: new Date("2026-09-15T05:00:00.000Z"),
    });
    await insertAuditRow(tenantId, {
      action: "member.create",
      createdAt: new Date("2026-09-15T06:00:00.000Z"),
    });

    const store = new FakeObjectStore();
    await runAuditCheckpointJob(tenantId, DAY, { store, secret: SECRET });

    const runVerify = () =>
      spawnSync(
        "npx",
        ["tsx", "scripts/verify-audit-checkpoint.ts", tenantId, DAY],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, AUDIT_CHECKPOINT_SECRET: SECRET },
        },
      );

    const green = runVerify();
    expect(green.status, `${green.stdout}\n${green.stderr}`).toBe(0);

    // Simulate the tamper an operator with DB access would perform:
    // the trigger has to be disabled first, which is exactly why it is
    // the tripwire and not the proof.
    await withoutMutationGuard(async () => {
      await admin.query(
        "update audit_log set action = 'tampered.action' where id = $1",
        [tamperedId],
      );
    });

    const red = runVerify();
    expect(red.status, `${red.stdout}\n${red.stderr}`).not.toBe(0);
    expect(`${red.stdout}${red.stderr}`).toMatch(/DIVERGENCE|digest mismatch/i);

    // With the manifest in hand, verifyCheckpoint() localises the
    // divergence to the exact row id.
    const { fromUtc, toUtc } = dayRangeUtc(DAY, TZ);
    const rows = await withTenant(tenantId, (tx) =>
      selectAuditRowsForDay(tx, asTenantId(tenantId), fromUtc, toUtc),
    );
    const manifest = JSON.parse(
      Buffer.from(store.objects.get(`audit-checkpoints/${tenantId}/${DAY}.json`)!.bytes).toString(
        "utf8",
      ),
    );
    const result = verifyCheckpoint(manifest, rows, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstDivergentRowId).toBe(tamperedId);
    }
  });
});
