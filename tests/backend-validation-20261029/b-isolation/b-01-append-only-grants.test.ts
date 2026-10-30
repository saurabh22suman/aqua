// H1 — effective app_user privileges and REAL mutation behaviour on the
// app_login -> app_user runtime path.
//
// INTENDED-CONTRACT regression. Before the approved patch
// (docs/audits/backend-validation-20261029/b-isolation/proposals/append-only-grants.patch)
// this file FAILED: app_user could UPDATE/DELETE the three log tables
// below. The patch adds them to db/app-privileges.ts's append-only
// restriction list, so a deploy's reconcile step re-revokes those
// privileges.
//
// Rules honoured here:
//   - The privileged pool (tests/db/privileged-fixture.ts) is FIXTURE ONLY:
//     setup + cleanup. Every assertion runs on the application path —
//     app_login -> `set role app_user`, never a superuser, never
//     BYPASSRLS, never the table owner.
//   - The file must not name the reserved privileged connection env
//     variable (tests/tier1/no-superuser-on-request-path.test.ts scans
//     for it); the privileged connection string is taken from the
//     fixture pool.
//   - Each mutation attempt runs in its OWN transaction: a refused
//     statement aborts its transaction, so a shared transaction would
//     poison the next attempt.
//   - All fixture rows are removed in afterAll, so a RED run leaves no
//     residue and the next run starts clean.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { withPlatform, withPlatformAdmin } from "@/db/scope";
import { withTenant } from "@/db/tenant";
import { env } from "@/lib/env";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

const RUN = Date.now().toString(36);
const FEATURE_KEY = `bv-h1-${RUN}`;
const APP_LOGIN = env.DATABASE_URL;
// The privileged connection string comes from the fixture pool's own
// options, so this file never names the privileged URL variable itself
// (tests/tier1/no-superuser-on-request-path.test.ts scans for that).
const MIGRATION_CONN = (admin as unknown as { options: { connectionString: string } })
  .options.connectionString;
// gate_access_events requires a 64-hex credential fingerprint for
// non-override methods (migration 20261025234623).
const FINGERPRINT = "a".repeat(64);

// Fixture ids, all unique per run so a RED run leaves no residue.
const ids = {
  tenant: uuidv7(),
  gateTenant: uuidv7(),
  person: uuidv7(),
  member: uuidv7(),
  program: uuidv7(),
  batch: uuidv7(),
  memberLocation: uuidv7(),
  gateLocation: uuidv7(),
  device: uuidv7(),
  gateEvent: uuidv7(),
  role: uuidv7(),
};

let actorId: string;

// A revoked privilege does not silently affect zero rows: Postgres
// refuses the statement with SQLSTATE 42501 (insufficient_privilege).
// The helper therefore reports REFUSED vs APPLIED, so the assertion
// shape is identical before and after the fix — RED is "the mutation was
// applied", GREEN is "the mutation was refused".
type MutationOutcome =
  | { refused: true; code: string }
  | { refused: false; rowCount: number };

async function attemptMutation(
  run: () => Promise<{ rowCount: number }>,
): Promise<MutationOutcome> {
  try {
    const result = await run();
    return { refused: false, rowCount: result.rowCount };
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause ?? err;
    const code = (cause as { code?: string }).code ?? "unknown";
    return { refused: true, code };
  }
}

beforeAll(async () => {
  // Establish the state a real deploy leaves behind: db/deploy.ts runs
  // bootstrapRoles (step 1) -> runMigrations (step 2) ->
  // reconcileAppPrivileges (step 3), and step 3 is what re-applies the
  // append-only restriction after the blanket grant of step 1.
  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  const { reconcileAppPrivileges } = await import("@/db/app-privileges");
  await bootstrapRoles(MIGRATION_CONN);
  await reconcileAppPrivileges(MIGRATION_CONN);
  // Fixture: a platform operator row (platform_audit_log.actor_id FK).
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'H1 Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [`bv-h1-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`bv-h1-${RUN}@platform.test`],
  );
  actorId = actor.rows[0]!.id;
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log where detail ->> 'key' = $1", [
    FEATURE_KEY,
  ]);
  await admin.query("delete from platform_users where email = $1", [
    `bv-h1-${RUN}@platform.test`,
  ]);
  // Tenant-scoped fixture chains (children first).
  await admin.query("delete from absence_alerts where tenant_id = any($1::uuid[])", [
    [ids.tenant],
  ]);
  await admin.query("delete from gate_access_events where tenant_id = any($1::uuid[])", [
    [ids.gateTenant],
  ]);
  await admin.query("delete from members where id = $1", [ids.member]);
  await admin.query("delete from persons where id = $1", [ids.person]);
  await admin.query("delete from batches where id = $1", [ids.batch]);
  await admin.query("delete from programs where id = $1", [ids.program]);
  await admin.query("delete from roles where id = $1", [ids.role]);
  await admin.query("delete from gate_devices where id = $1", [ids.device]);
  await admin.query("delete from locations where id = any($1::uuid[])", [
    [ids.memberLocation, ids.gateLocation],
  ]);
  await admin.query("delete from tenants where id = any($1::uuid[])", [
    [ids.tenant, ids.gateTenant],
  ]);
  await admin.end();
});

describe("H1 — append-only log tables are append-only for app_user", () => {
  it("the REAL application pool (db/client.ts + withPlatform) is app_login -> app_user and lacks DELETE on platform_audit_log", async () => {
    // This asserts the actual imported service pool — db/client.ts's
    // `db` with its onConnect hook (`set role app_user`) — not a
    // hand-built Pool. The privileged list above is fixture-only; this
    // is the pool every request-path query uses.
    const identity = await withPlatform(() =>
      db.transaction((tx) =>
        tx.execute<{
          current_user: string;
          session_user: string;
          current_database: string;
          can_delete_platform_audit_log: boolean;
        }>(sql`
          select current_user,
                 session_user,
                 current_database(),
                 has_table_privilege(current_user, 'platform_audit_log', 'DELETE')
                   as can_delete_platform_audit_log
        `),
      ),
    );
    const row = (identity as unknown as {
      rows: Array<{
        current_user: string;
        session_user: string;
        current_database: string;
        can_delete_platform_audit_log: boolean;
      }>;
    }).rows[0]!;

    expect(row.current_user, "the service pool must act as app_user").toBe("app_user");
    expect(row.session_user, "the service pool must log in as app_login").toBe("app_login");
    expect(row.current_database).toBe(
      // The disposable harness database; never printed in full elsewhere.
      (admin as unknown as { options: { connectionString: string } }).options
        .connectionString.split("/").pop(),
    );
    expect(
      row.can_delete_platform_audit_log,
      "the service pool must not hold DELETE on platform_audit_log",
    ).toBe(false);
  });

  it("a service-pool DELETE of platform_audit_log is refused (the same shape a test cleanup uses)", async () => {
    // Mirrors the cleanup shape a tenant-scoped test performs inside
    // withTenant: delete platform_audit_log rows for one tenant. It must
    // be refused on the service pool.
    const outcome = await attemptMutation(async () =>
      withTenant(ids.tenant as never, async (tx) => {
        const r = await tx.execute(sql`
          delete from platform_audit_log where tenant_id = ${ids.tenant}::uuid
        `);
        return { rowCount: (r as unknown as { rowCount: number }).rowCount };
      }),
    );
    expect(
      outcome,
      "a service-pool DELETE on platform_audit_log must be refused, not silently applied",
    ).toMatchObject({ refused: true });
    expect(
      (outcome as { code?: string }).code,
      "the refusal must be insufficient_privilege (42501)",
    ).toBe("42501");
  });

  it("the runtime connection really is app_login -> app_user (no superuser, no BYPASSRLS)", async () => {
    // A dedicated client on the SAME credentials the application uses:
    // app_login connects, then SET ROLE app_user (db/client.ts's
    // onConnect does exactly this). One client, so the role applies to
    // every statement on it.
    const client = new Pool({ connectionString: APP_LOGIN, max: 1 });
    const conn = await client.connect();
    try {
      await conn.query("set role app_user");
      const who = await conn.query<{
        current_user: string;
        session_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `select current_user, session_user, rolsuper, rolbypassrls
           from pg_roles where rolname = current_user`,
      );
      expect(who.rows[0]).toEqual({
        current_user: "app_user",
        session_user: "app_login",
        rolsuper: false,
        rolbypassrls: false,
      });
    } finally {
      conn.release();
      await client.end();
    }
  });

  it("platform_audit_log: app_user may INSERT and SELECT, but not UPDATE or DELETE", async () => {
    // Positive control — the legitimate append path must keep working.
    const inserted = await withPlatformAdmin(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        insert into platform_audit_log (actor_id, tenant_id, action, target_type, target_id, detail)
        values (${actorId}::uuid, null, 'bv.h1.probe', 'feature', null, ${JSON.stringify({ key: FEATURE_KEY })}::jsonb)
        returning id
      `);
      return (rows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    });
    const readBack = await withPlatformAdmin(async (tx) => {
      const rows = await tx.execute(sql`
        select id from platform_audit_log where id = ${inserted}::uuid
      `);
      return (rows as unknown as { rows: unknown[] }).rows.length;
    });
    expect(readBack).toBe(1);

    // The intended contract: a log row cannot be rewritten or removed by
    // the request-path role.
    const updateOutcome = await attemptMutation(async () =>
      withPlatformAdmin(async (tx) => {
        const r = await tx.execute(sql`
          update platform_audit_log
             set detail = detail || '{"tampered":true}'::jsonb
           where id = ${inserted}::uuid
        `);
        return { rowCount: (r as unknown as { rowCount: number }).rowCount };
      }),
    );
    expect(
      updateOutcome,
      "app_user must not be able to UPDATE platform_audit_log",
    ).toMatchObject({ refused: true });

    const deleteOutcome = await attemptMutation(async () =>
      withPlatformAdmin(async (tx) => {
        const r = await tx.execute(sql`
          delete from platform_audit_log where id = ${inserted}::uuid
        `);
        return { rowCount: (r as unknown as { rowCount: number }).rowCount };
      }),
    );
    expect(
      deleteOutcome,
      "app_user must not be able to DELETE platform_audit_log",
    ).toMatchObject({ refused: true });

    // The row survived both attempts.
    const survivor = await withPlatformAdmin(async (tx) => {
      const rows = await tx.execute(sql`
        select detail from platform_audit_log where id = ${inserted}::uuid
      `);
      return (rows as unknown as { rows: Array<{ detail: unknown }> }).rows;
    });
    expect(survivor).toHaveLength(1);
    expect(
      (survivor[0]!.detail as Record<string, unknown>).tampered,
      "the audit row must not carry a tampered marker",
    ).toBeUndefined();
  });

  it("absence_alerts: app_user may INSERT and SELECT, but not UPDATE or DELETE (alerts are read-only by design)", async () => {
    // Fixture chain: absence_alerts has composite FKs to a real member and
    // batch of the same tenant, so the fixture seeds the whole chain.
    await admin.query(
      `insert into tenants (id, slug, name, status) values ($1, $2, 'H1 Tenant', 'active')`,
      [ids.tenant, `bv-h1-${RUN}`],
    );
    await admin.query(
      `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'H1 Member Location', true)`,
      [ids.memberLocation, ids.tenant],
    );
    await admin.query(
      `insert into persons (id, tenant_id, full_name) values ($1, $2, 'H1 Person')`,
      [ids.person, ids.tenant],
    );
    await admin.query(
      `insert into members (id, tenant_id, person_id, location_id, status, member_code)
       values ($1, $2, $3, $4, 'active', $5)`,
      [ids.member, ids.tenant, ids.person, ids.memberLocation, `H1-${RUN}`],
    );
    await admin.query(
      `insert into programs (id, tenant_id, name) values ($1, $2, 'H1 Program')`,
      [ids.program, ids.tenant],
    );
    await admin.query(
      `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time)
       values ($1, $2, $3, 'H1 Batch', 10, '{1}', '07:00', '08:00')`,
      [ids.batch, ids.tenant, ids.program],
    );
    await admin.query(
      `insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal)
       values ($1, $2, 'h1_role', 'H1 Role', false, '/owner', 9)`,
      [ids.role, ids.tenant],
    );
    await admin.query(
      `insert into absence_alerts (tenant_id, member_id, batch_id, alert_kind, calendar_week)
       values ($1, $2, $3, 'consecutive_absences', '2026-W40')`,
      [ids.tenant, ids.member, ids.batch],
    );

    // Positive control: the daily job's INSERT path must keep working.
    const inserted = await withTenant(ids.tenant as never, async (tx) => {
      const r = await tx.execute(sql`
        insert into absence_alerts (tenant_id, member_id, batch_id, alert_kind, calendar_week)
        values (${ids.tenant}::uuid, ${ids.member}::uuid, ${ids.batch}::uuid, 'low_monthly_attendance', '2026-W41')
      `);
      return (r as unknown as { rowCount: number }).rowCount;
    });
    expect(inserted).toBe(1);

    const updateOutcome = await attemptMutation(async () =>
      withTenant(ids.tenant as never, async (tx) => {
        const r = await tx.execute(sql`
          update absence_alerts
             set detail = detail || '{"tampered":true}'::jsonb
           where tenant_id = ${ids.tenant}::uuid
        `);
        return { rowCount: (r as unknown as { rowCount: number }).rowCount };
      }),
    );
    expect(
      updateOutcome,
      "app_user must not be able to UPDATE absence_alerts",
    ).toMatchObject({ refused: true });

    const deleteOutcome = await attemptMutation(async () =>
      withTenant(ids.tenant as never, async (tx) => {
        const r = await tx.execute(sql`
          delete from absence_alerts where tenant_id = ${ids.tenant}::uuid
        `);
        return { rowCount: (r as unknown as { rowCount: number }).rowCount };
      }),
    );
    expect(
      deleteOutcome,
      "app_user must not be able to DELETE absence_alerts",
    ).toMatchObject({ refused: true });

    // Control against over-revocation: an ordinary tenant table the app
    // role legitimately mutates must stay mutable.
    const roleUpdate = await withTenant(ids.tenant as never, async (tx) => {
      const r = await tx.execute(sql`
        update roles set name = 'H1 Role Renamed' where id = ${ids.role}::uuid
      `);
      return (r as unknown as { rowCount: number }).rowCount;
    });
    expect(
      roleUpdate,
      "an ordinary tenant table must stay mutable for app_user",
    ).toBe(1);
  });

  it("gate_access_events: app_user may INSERT and SELECT, but not UPDATE or DELETE (append-only access log)", async () => {
    await admin.query(
      `insert into tenants (id, slug, name, status) values ($1, $2, 'H1 Gate Tenant', 'active')`,
      [ids.gateTenant, `bv-h1-gate-${RUN}`],
    );
    await admin.query(
      `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'H1 Gate Location', true)`,
      [ids.gateLocation, ids.gateTenant],
    );
    await admin.query(
      `insert into gate_devices (id, tenant_id, location_id, device_key, label, accepts_pin)
       values ($1, $2, $3, 'h1-device', 'H1 Device', true)`,
      [ids.device, ids.gateTenant, ids.gateLocation],
    );
    await admin.query(
      `insert into gate_access_events (id, tenant_id, device_id, method, decision, reason_code, credential_fingerprint, occurred_at, client_event_id)
       values ($1, $2, $3, 'pin', 'denied', 'denied_unknown_device', $4, now(), 'h1-fixture')`,
      [ids.gateEvent, ids.gateTenant, ids.device, FINGERPRINT],
    );

    const inserted = await withTenant(ids.gateTenant as never, async (tx) => {
      const r = await tx.execute(sql`
        insert into gate_access_events (id, tenant_id, device_id, method, decision, reason_code, credential_fingerprint, occurred_at, client_event_id)
        values (${uuidv7()}::uuid, ${ids.gateTenant}::uuid, ${ids.device}::uuid, 'pin', 'denied', 'denied_unknown_device', ${FINGERPRINT}, now(), 'h1-probe')
      `);
      return (r as unknown as { rowCount: number }).rowCount;
    });
    expect(inserted).toBe(1);

    const updateOutcome = await attemptMutation(async () =>
      withTenant(ids.gateTenant as never, async (tx) => {
        const r = await tx.execute(sql`
          update gate_access_events
             set reason_code = 'granted_manual_override'
           where tenant_id = ${ids.gateTenant}::uuid
        `);
        return { rowCount: (r as unknown as { rowCount: number }).rowCount };
      }),
    );
    expect(
      updateOutcome,
      "app_user must not be able to UPDATE gate_access_events",
    ).toMatchObject({ refused: true });

    const deleteOutcome = await attemptMutation(async () =>
      withTenant(ids.gateTenant as never, async (tx) => {
        const r = await tx.execute(sql`
          delete from gate_access_events where tenant_id = ${ids.gateTenant}::uuid
        `);
        return { rowCount: (r as unknown as { rowCount: number }).rowCount };
      }),
    );
    expect(
      deleteOutcome,
      "app_user must not be able to DELETE gate_access_events",
    ).toMatchObject({ refused: true });
  });

  it("a deploy re-run (bootstrapRoles) must not hand UPDATE/DELETE back to the append-only tables", async () => {
    // db/deploy.ts runs bootstrapRoles (step 1) -> runMigrations (step 2)
    // -> reconcileAppPrivileges (step 3) on EVERY deploy. bootstrapRoles
    // grants blanket select/insert/update/delete and ALTER DEFAULT
    // PRIVILEGES, so any table whose append-only contract is enforced only
    // inside a migration loses it on the next deploy unless
    // reconcileAppPrivileges re-revokes it.
    const { bootstrapRoles } = await import("@/db/bootstrap-roles");
    const { reconcileAppPrivileges } = await import("@/db/app-privileges");
    await bootstrapRoles(MIGRATION_CONN);
    await reconcileAppPrivileges(MIGRATION_CONN);

    const priv = await withPlatform(async () => {
      const rows = await db.execute<{ upd: boolean; del: boolean }>(sql`
        select has_table_privilege('app_user', 'gate_access_events', 'update') as upd,
               has_table_privilege('app_user', 'gate_access_events', 'delete') as del
      `);
      return (rows as unknown as { rows: Array<{ upd: boolean; del: boolean }> }).rows[0];
    });
    expect(
      priv,
      "after a deploy, app_user must still not hold UPDATE/DELETE on gate_access_events",
    ).toEqual({ upd: false, del: false });
  });
});
