import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "../helpers/isolated-db";
import { startIsolatedDb } from "../helpers/isolated-db";
import { RLS_EXEMPT_TABLES } from "@/db/allowlist";


let isolated: IsolatedDb;
let admin: Pool;
let app: Pool;
const tenantA = uuidv7();
const tenantB = uuidv7();

async function inTenant<T>(
  client: Pool,
  tenantId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await client.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(c);
  } finally {
    await c.query("commit");
    c.release();
  }
}

beforeAll(async () => {
  isolated = await startIsolatedDb();
  admin = isolated.admin;

  const mutate = process.env.ISOLATION_MUTATE;

  if (mutate === "drop-policy") {
    await admin.query("drop policy tenant_isolation on locations");
  } else if (mutate === "no-force") {
    await admin.query(
      "alter table membership_locations no force row level security",
    );
  } else if (mutate === "bare-table") {
    await admin.query(
      "create table _bare_probe (id uuid primary key, tenant_id uuid not null)",
    );
  }

  await admin.query(
    "insert into tenants (id, slug, name) values ($1,'iso-a','Isolation A')",
    [tenantA],
  );
  await admin.query(
    "insert into tenants (id, slug, name) values ($1,'iso-b','Isolation B')",
    [tenantB],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1,$2,'A Hall',true)",
    [uuidv7(), tenantA],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1,$2,'B Hall',true)",
    [uuidv7(), tenantB],
  );

  app = new Pool({
    connectionString: isolated.appUri,
    max: 4,
    onConnect: async (client) => {
      await client.query("set role app_user");
    },
  });
}, 180_000);

afterAll(async () => {
  await app?.end();
  await isolated?.stop();
});

describe("tenant isolation — the blocking gate", () => {
  it("an unscoped query inside a tenant context returns only that tenant's rows", async () => {
    const rows = await inTenant(app, tenantA, (c) =>
      c.query<{ name: string }>("select name from locations"),
    );
    expect(rows.rows.map((r) => r.name)).toEqual(["A Hall"]);
  });

  it("a hostile query explicitly naming another tenant's id returns nothing", async () => {
    const otherIds = await inTenant(app, tenantB, (c) =>
      c.query<{ id: string }>("select id from locations"),
    );
    const foreignId = otherIds.rows[0].id;

    const rows = await inTenant(app, tenantA, (c) =>
      c.query("select id from locations where id = $1", [foreignId]),
    );
    expect(rows.rows).toHaveLength(0);

    const allInB = await inTenant(app, tenantA, (c) =>
      c.query("select id from locations where id in (select id from locations)"),
    );
    for (const row of allInB.rows) expect(row.id).not.toBe(foreignId);
  });

  it("current_user is app_user on every connection, session_user is app_login", async () => {
    const fresh = new Pool({
      connectionString: isolated.appUri,
      max: 1,
      onConnect: async (client) => {
        await client.query("set role app_user");
      },
    });
    try {
      const { rows } = await fresh.query<{
        current_user: string;
        session_user: string;
      }>("select current_user, session_user");
      expect(rows[0].current_user).toBe("app_user");
      expect(rows[0].session_user).toBe("app_login");
    } finally {
      await fresh.end();
    }
  });

  it("a warm pooled connection with NO context returns zero rows, never an error", async () => {
    await inTenant(app, tenantA, (c) => c.query("select 1"));

    const c = await app.connect();
    try {
      const { rows } = await c.query<{ n: number }>(
        "select count(*)::int as n from locations",
      );
      expect(rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it("catch-all: every public table has RLS enabled AND forced unless allowlisted", async () => {
    const { rows } = await admin.query<{
      relname: string;
      rls: boolean;
      forced: boolean;
    }>(
      `select c.relname,
              c.relrowsecurity       as rls,
              c.relforcerowsecurity  as forced
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'`,
    );

    const violations = rows.filter(
      (t) =>
        !RLS_EXEMPT_TABLES.has(t.relname) && (t.rls === false || t.forced === false),
    );

    expect(violations).toEqual([]);
  });
});
