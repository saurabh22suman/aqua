import { afterAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { auditLog } from "@/db/schema/audit";
import { asTenantId, type TenantId } from "@/lib/ids";
import { deleteAuditRows } from "../helpers/audit-log-cleanup";

// H-03 — audit_log is rebuilt as a monthly RANGE-partitioned table by
// created_at, with a static horizon. Written before
// db/migrations/20260918090000_h03_audit_log_partitioning.sql exists:
// the first run of this file is deliberately red — audit_log is a plain
// table on main, so the pg_partitioned_table probe is empty and the
// 2028-06 insert fails with "no partition of relation ... found".
//
// Introspection runs through the privileged pool (same fixture pattern
// as tests/tier1/hardening-indexes.test.ts); every write and the
// UPDATE/DELETE denials run through the real app path, withTenant over
// app_user — a superuser check would prove nothing about the app role.
//
// No default partition is asserted on purpose: a beyond-horizon insert
// must fail loudly (2029 case below), never accumulate in a catch-all
// no retention policy would ever drop. Future partitions are added by
// migration (the E-05 precedent); runtime DDL is deferred to an H-03
// follow-up because app_user has no CREATE and MIGRATION_DATABASE_URL
// never reaches a runtime path.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantIds: TenantId[] = [];
function makeTenantId(): TenantId {
  const id = asTenantId(uuidv7());
  tenantIds.push(id);
  return id;
}

function monthPartitionName(d: Date): string {
  return `audit_log_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function insertAudit(
  tenantId: TenantId,
  createdAt: Date,
  action = `h03.${RUN}`,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.insert(auditLog).values({
      tenantId,
      actorType: "system",
      action,
      entityType: "h03_test",
      source: "job",
      createdAt,
      after: { run: RUN },
    });
  });
}

// Drizzle wraps driver errors; collect both the wrapper and the real
// Postgres error on `.cause` so assertions read the failure, not the
// wrapper (same helper shape as tests/tier1/activity-events.test.ts).
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "(resolved)";
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    return `${e.message ?? ""} | ${e.cause?.message ?? ""}`;
  }
}

afterAll(async () => {
  if (tenantIds.length > 0) {
    await deleteAuditRows(admin, "tenant_id = any($1::uuid[])", [tenantIds]);
  }
  await admin.end();
});

describe("H-03 — partitioned audit_log", () => {
  it("is a range-partitioned table with primary key (id, created_at)", async () => {
    const { rows } = await admin.query<{ partstrat: string }>(
      "select partstrat from pg_partitioned_table where partrelid = 'audit_log'::regclass",
    );
    expect(rows).toEqual([{ partstrat: "r" }]);

    const { rows: pk } = await admin.query<{ attname: string }>(
      `select a.attname
         from pg_index i
         cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where i.indrelid = 'audit_log'::regclass and i.indisprimary
        order by k.ord`,
    );
    expect(pk.map((r) => r.attname)).toEqual(["id", "created_at"]);
  });

  it("has monthly partitions through 2028-12 and no default partition", async () => {
    const { rows } = await admin.query<{ relname: string; bound: string }>(
      `select c.relname, pg_get_expr(c.relpartbound, c.oid) as bound
         from pg_inherits i
         join pg_class c on c.oid = i.inhrelid
        where i.inhparent = 'audit_log'::regclass
        order by c.relname`,
    );
    const names = rows.map((r) => r.relname);
    expect(rows.some((r) => r.bound === "DEFAULT")).toBe(false);
    expect(names).toContain("audit_log_2026_01");
    expect(names).toContain(monthPartitionName(new Date()));
    expect(names).toContain("audit_log_2028_06");
    expect(names).toContain("audit_log_2028_12");
  });

  it("routes a 2028-06 insert into audit_log_2028_06", async () => {
    const tenantId = makeTenantId();
    const action = `h03.route.${RUN}`;
    await insertAudit(tenantId, new Date("2028-06-15T12:00:00.000Z"), action);

    const { rows } = await admin.query<{ part: string }>(
      `select tableoid::regclass::text as part
         from audit_log
        where tenant_id = $1 and action = $2`,
      [tenantId, action],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].part).toBe("audit_log_2028_06");
  });

  it("fails loudly on a 2029 insert (no default partition)", async () => {
    const tenantId = makeTenantId();
    const message = await rejectionMessage(
      insertAudit(tenantId, new Date("2029-01-15T00:00:00.000Z")),
    );
    expect(message).toMatch(
      /no partition of relation "audit_log" found for row/,
    );
  });

  it("canonical index and constraint names survive the swap", async () => {
    const { rows } = await admin.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'audit_log'
        order by indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      "audit_log_pkey",
      "audit_log_tenant_action_created_idx",
      "audit_log_tenant_id_created_at_idx",
      "audit_log_tenant_id_entity_idx",
    ]);

    const { rows: leftovers } = await admin.query<{ n: number }>(
      "select count(*)::int as n from pg_class where relname like 'audit_log_new%'",
    );
    expect(leftovers[0].n).toBe(0);

    const { rows: checks } = await admin.query<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'audit_log'::regclass and contype = 'c'
        order by conname`,
    );
    expect(checks.map((r) => r.conname)).toEqual([
      "audit_log_actor_type_check",
      "audit_log_source_check",
    ]);
  });
});

describe("H-03 — RLS and grants", () => {
  it("forces RLS with the nullif tenant_isolation policy on the parent and every partition", async () => {
    const { rows: parent } = await admin.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'audit_log'::regclass",
    );
    expect(parent[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
    });

    const { rows: partitions } = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_inherits i
         join pg_class c on c.oid = i.inhrelid
        where i.inhparent = 'audit_log'::regclass`,
    );
    expect(partitions.length).toBeGreaterThanOrEqual(1);
    expect(
      partitions
        .filter((p) => !p.relrowsecurity || !p.relforcerowsecurity)
        .map((p) => p.relname),
    ).toEqual([]);

    const names = ["audit_log", ...partitions.map((p) => p.relname)];
    const { rows: policies } = await admin.query<{
      tablename: string;
      qual: string;
      with_check: string;
    }>(
      `select tablename, qual, with_check from pg_policies
        where tablename = any($1::text[]) and policyname = 'tenant_isolation'`,
      [names],
    );
    expect(policies.map((p) => p.tablename).sort()).toEqual([...names].sort());

    const nullif = /nullif\s*\(\s*current_setting\('app\.tenant_id'/i;
    for (const policy of policies) {
      expect(nullif.test(policy.qual), `${policy.tablename}.qual`).toBe(true);
      expect(nullif.test(policy.with_check), `${policy.tablename}.with_check`).toBe(
        true,
      );
    }
  });

  it("direct partition access does not bypass RLS", async () => {
    const tenantId = makeTenantId();
    await insertAudit(tenantId, new Date("2028-06-16T00:00:00.000Z"));

    const app = new Client({ connectionString: env.DATABASE_URL });
    await app.connect();
    try {
      await app.query("set role app_user");
      const { rows } = await app.query<{ n: number }>(
        "select count(*)::int as n from audit_log_2028_06",
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await app.end();
    }
  });

  it("app_user can INSERT and SELECT but cannot UPDATE or DELETE", async () => {
    const tenantId = makeTenantId();
    await insertAudit(tenantId, new Date("2028-07-10T00:00:00.000Z"));

    const selected = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(auditLog);
      return rows[0].n;
    });
    expect(selected).toBe(1);

    const updateMessage = await rejectionMessage(
      withTenant(tenantId, (tx) =>
        tx.execute(
          sql`update audit_log set action = 'x' where tenant_id = ${tenantId}`,
        ),
      ),
    );
    expect(updateMessage).toMatch(/permission denied for table audit_log/);

    const deleteMessage = await rejectionMessage(
      withTenant(tenantId, (tx) =>
        tx.execute(sql`delete from audit_log where tenant_id = ${tenantId}`),
      ),
    );
    expect(deleteMessage).toMatch(/permission denied for table audit_log/);

    const { rows: grants } = await admin.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'app_user' and table_schema = 'public' and table_name = 'audit_log'
        order by privilege_type`,
    );
    expect(grants.map((g) => g.privilege_type)).toEqual(["INSERT", "SELECT"]);

    const { rows: seq } = await admin.query<{ ok: boolean }>(
      "select has_sequence_privilege('app_user', 'audit_log_id_seq', 'USAGE') as ok",
    );
    expect(seq[0].ok).toBe(true);
  });
});
