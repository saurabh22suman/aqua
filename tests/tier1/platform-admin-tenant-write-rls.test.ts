import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withPlatformAdmin } from "@/db/scope";

// Phase 1.5 — proves the migration
// 20260902200000_platform_admin_tenant_write.sql holds: app_user can
// INSERT into tenants and locations only when app.platform_admin =
// 'true'. Without it, the existing tenant_isolation's WITH CHECK
// (id = app.tenant_id) keeps both inserts denied. The policy is
// additive, not a weakening — the same deny still applies for any
// caller that doesn't open with withPlatformAdmin().
//
// Two connection flavours in play here on purpose:
//   - env.DATABASE_URL pool, the application pool, role app_user.
//     Connects, runs SET ROLE app_user already (db/client.ts), and
//     reaches the RLS-subjected surface this migration lives on. Every
//     assert below routes through that pool.
//   - env.MIGRATION_DATABASE_URL pool, role aqua (superuser). Used
//     only to inspect pg_policy / clean up the throwaway rows the
//     test inserts. Reads/cleans data with RLS bypassed, which would
//     be unsafe on the request path (architecture §5.6) — but a
//     vitest suite is not a request path.
//
// Fixtures: a unique slug per RUN keeps the test re-runnable against
// a long-lived dev database. The run-id goes on every slug so the
// tenant is grep-able; cleanup matches on it.

const appPool = new Pool({ connectionString: env.DATABASE_URL });
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const SLUG_PREFIX = `rls-test-${RUN}`;
const created: Array<{ id: string; slug: string }> = [];

beforeAll(async () => {
  // The application pool's onConnect SET ROLE runs at connect time,
  // and installScopeGuard skips whitelisted SET statements — but
  // directly constructing `appPool.connect()` skips that path. So
  // we explicitly SET ROLE on every checked-out connection inside
  // the run. Tests below that need a fresh, non-scope-guard client
  // use a raw `pg` connection without entering the drizzle client.
  // We deliberately do NOT use `appDb` here — the scope guard would
  // throw "Unscoped query" on a tenant-less SELECT, even on this
  // test's intentional deny-path setups.
  await appPool.query("set role app_user");
  await admin.query("set role none");
});

afterAll(async () => {
  if (created.length > 0) {
    const ids = created.map((r) => r.id);
    await admin.query("delete from locations where tenant_id = any($1::uuid[])", [ids]);
    await admin.query("delete from tenants where id = any($1::uuid[])", [ids]);
  }
  await appPool.end();
  await admin.end();
});

async function createRowDirect(opts: {
  appPlatformAdmin: "true" | "false" | "unset";
  slug: string;
}) {
  // Pull a fresh app_user connection from the pool. SET ROLE
  // app_user is implicit on connect (db/client.ts), but a manual
  // pool bypasses that — set it again here, then optionally flip
  // app.platform_admin to false and watch the policy flip behavior.
  const client = await appPool.connect();
  try {
    await client.query("set role app_user");
    if (opts.appPlatformAdmin !== "unset") {
      await client.query(
        "select set_config('app.platform_admin', $1, true)",
        [opts.appPlatformAdmin],
      );
    } else {
      await client.query(
        "select set_config('app.platform_admin', '', true)",
      );
    }
    await client.query("begin");
    try {
      const id = uuidv7();
      await client.query(
        `insert into tenants (id, slug, name, status, plan_id, timezone, currency)
         values ($1, $2, 'RLS Test', 'trial', null, 'Asia/Kolkata', 'INR')`,
        [id, opts.slug],
      );
      await client.query(
        `insert into locations (id, tenant_id, name, is_primary)
         values ($1, $2, 'Main', true)`,
        [uuidv7(), id],
      );
      await client.query("commit");
      return { id };
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

describe("platform_admin_insert policy on tenants + locations", () => {
  it("lets withPlatformAdmin() insert both rows in one transaction", async () => {
    const id = uuidv7();
    const slug = `${SLUG_PREFIX}-allow`;
    const result = await withPlatformAdmin(async (tx) => {
      await tx.execute(sql`
        insert into tenants (id, slug, name, status, plan_id, timezone, currency)
        values (${id}, ${slug}, 'Policy Permit', 'trial', null, 'Asia/Kolkata', 'INR')
      `);
      await tx.execute(sql`
        insert into locations (id, tenant_id, name, is_primary)
        values (${uuidv7()}, ${id}, 'Main', true)
      `);
      return true;
    });
    expect(result).toBe(true);
    created.push({ id, slug });

    // Round-trip read under withPlatformAdmin — also a sanity check
    // that the new row is visible to the same scope that wrote it.
    const seen = await withPlatformAdmin(async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        sql`select id from tenants where id = ${id}`,
      );
      return (rows as unknown as { rows: Array<{ id: string }> }).rows
        .length > 0;
    });
    expect(seen).toBe(true);
  });

  it("denies the same INSERTs on an app_user connection with app.platform_admin = 'false'", async () => {
    const slug = `${SLUG_PREFIX}-deny-false`;
    let threw = false;
    try {
      await createRowDirect({ appPlatformAdmin: "false", slug });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Confirm the row was NOT written (else the test pattern leaks).
    const rows = await admin.query<{ count: string }>(
      "select count(*)::text from tenants where slug = $1",
      [slug],
    );
    expect(Number(rows.rows[0]?.count ?? "0")).toBe(0);
  });

  it("denies the same INSERTs when app.platform_admin is unset entirely", async () => {
    const slug = `${SLUG_PREFIX}-deny-unset`;
    let threw = false;
    try {
      await createRowDirect({ appPlatformAdmin: "unset", slug });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("keeps the original tenant_isolation policy alongside the new one (deny when neither matches)", async () => {
    // Connection sets app.platform_admin = ''  (unset) and never
    // sets app.tenant_id. tenant_isolation's WITH CHECK requires
    // (id = app.tenant_id), which is false here. platform_admin_insert's
    // WITH CHECK requires (app.platform_admin = 'true'), also false.
    // Both policies fail; Postgres default-deny kicks in.
    const client = await appPool.connect();
    try {
      await client.query("set role app_user");
      await client.query(
        "select set_config('app.platform_admin', '', true)",
      );
      await client.query("begin");
      let threw = false;
      try {
        await client.query(
          `insert into tenants (id, slug, name, status, plan_id, timezone, currency)
           values ($1, $2, 'Both Deny', 'trial', null, 'Asia/Kolkata', 'INR')`,
          [uuidv7(), `${SLUG_PREFIX}-both-deny`],
        );
      } catch {
        threw = true;
      } finally {
        await client.query("rollback");
      }
      expect(threw).toBe(true);
    } finally {
      client.release();
    }
  });

  it("app.platform_admin is read from the SAME connection's set_config — fresh client → unset → deny", async () => {
    // Cross-connection leak guard. set_config's third argument is
    // 'true' for transaction-scoped across every connection in the
    // pool — a deliberate decision so the per-tx scope never
    // bleeds. A second connection without its own set_config sees
    // app.platform_admin as empty and INSERT fails closed.
    const first = await appPool.connect();
    const second = await appPool.connect();
    try {
      await first.query("set role app_user");
      await first.query(
        "select set_config('app.platform_admin', 'true', true)",
      );
      await second.query("set role app_user");
      const visible = await second.query<{ v: string }>(
        "select coalesce(nullif(current_setting('app.platform_admin', true), ''), '<empty>') as v",
      );
      expect(visible.rows[0]?.v).toBe("<empty>");

      // And now second connection tries to INSERT a tenant →
      // must fail (the policy doesn't see the marker set on
      // connection #1).
      let threw = false;
      try {
        await second.query("begin");
        await second.query(
          `insert into tenants (id, slug, name, status, plan_id, timezone, currency)
           values ($1, $2, 'Leak Check', 'trial', null, 'Asia/Kolkata', 'INR')`,
          [uuidv7(), `${SLUG_PREFIX}-leak-check`],
        );
        await second.query("commit");
      } catch {
        await second.query("rollback").catch(() => undefined);
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      first.release();
      second.release();
    }
  });

  it("honours db/scope.ts's withPlatformAdmin on the production path (idempotent under repeat calls)", async () => {
    // Sanity that the wrapper function the production code uses still
    // sees the migration's policy on multiple sequential calls —
    // a test that breaks if the policy regresses from a future
    // re-migration against an existing DB. Two insert/delete rounds
    // in a loop; the second round is the one that has hit the table
    // before.
    for (let i = 0; i < 2; i++) {
      const id = uuidv7();
      const slug = `${SLUG_PREFIX}-loop-${i}`;
      await withPlatformAdmin(async (tx) => {
        await tx.execute(sql`
          insert into tenants (id, slug, name, status, plan_id, timezone, currency)
          values (${id}, ${slug}, 'Loop', 'trial', null, 'Asia/Kolkata', 'INR')
        `);
      });
      created.push({ id, slug });
      // Cleanup immediately so the unique-slug constraint doesn't
      // collide on the next iteration in a stuck rerun.
      await admin.query("delete from tenants where id = $1", [id]);
      created.pop();
    }
  });
});
