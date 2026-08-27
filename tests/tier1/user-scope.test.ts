import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant, withUser } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { resolveHomePath, resolveDefaultMembership } from "@/db/platform";

// tenants/roles/tenant_memberships carry FORCE row level security, so
// fixtures are written through the privileged migration pool, never the
// app pool. This mirrors tests/tier1/roles-permissions.test.ts.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const tenantX = uuidv7();
const tenantY = uuidv7();

let userA = "";
let userB = "";
let roleXId = "";
let roleYId = "";
let membershipA_X = "";
let membershipA_Y = "";
let membershipB_X = "";

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name) values ($1,$2,'User Scope X'), ($3,$4,'User Scope Y')",
    [tenantX, `uscope-x-${RUN}`, tenantY, `uscope-y-${RUN}`],
  );

  roleXId = uuidv7();
  roleYId = uuidv7();
  await admin.query(
    "insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal) values ($1,$2,'owner','Owner',true,'/owner',0)",
    [roleXId, tenantX],
  );
  await admin.query(
    "insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal) values ($1,$2,'coach','Coach',true,'/coach',2)",
    [roleYId, tenantY],
  );

  userA = uuidv7();
  userB = uuidv7();
  await admin.query(
    "insert into users (id, phone, better_auth_id) values ($1,$2,$3), ($4,$5,$6)",
    [userA, `uscope-a-${RUN}`, `uscope-ba-a-${RUN}`, userB, `uscope-b-${RUN}`, `uscope-ba-b-${RUN}`],
  );

  membershipA_X = uuidv7();
  membershipA_Y = uuidv7();
  membershipB_X = uuidv7();
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1,$2,$3,$4,'active')",
    [membershipA_X, tenantX, userA, roleXId],
  );
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1,$2,$3,$4,'active')",
    [membershipA_Y, tenantY, userA, roleYId],
  );
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1,$2,$3,$4,'active')",
    [membershipB_X, tenantX, userB, roleXId],
  );
});

afterAll(async () => {
  await admin.query("delete from tenant_memberships where tenant_id = any($1)", [[tenantX, tenantY]]);
  await admin.query("delete from roles where tenant_id = any($1)", [[tenantX, tenantY]]);
  await admin.query("delete from users where id = any($1)", [[userA, userB]]);
  await admin.query("delete from tenants where id = any($1)", [[tenantX, tenantY]]);
  await admin.end();
});

describe("pre-tenant resolution — user-scoped RLS (F-06 follow-up)", () => {
  it("pg_policies: tenant_memberships/tenants/roles each carry exactly two policies, user_resolution is SELECT-only", async () => {
    const { rows } = await admin.query<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
       where tablename in ('tenant_memberships', 'tenants', 'roles')
       order by tablename, policyname`,
    );
    for (const table of ["tenant_memberships", "tenants", "roles"]) {
      const forTable = rows.filter((r) => r.tablename === table);
      expect(forTable, table).toHaveLength(2);
      const userPolicy = forTable.find((r) => r.policyname === "user_resolution");
      expect(userPolicy?.cmd, `${table} user_resolution cmd`).toBe("SELECT");
      const tenantPolicy = forTable.find((r) => r.policyname === "tenant_isolation");
      expect(tenantPolicy?.cmd, `${table} tenant_isolation cmd`).toBe("ALL");
    }
  });

  it("an unscoped query inside withUser(userA) returns exactly userA's own rows, across both tenants — the WHERE-clause-dropped proof", async () => {
    const rows = await withUser(userA, (tx) => tx.select().from(tenantMemberships));
    expect(rows.map((r) => r.id).sort()).toEqual([membershipA_X, membershipA_Y].sort());
    expect(rows.every((r) => r.userId === userA)).toBe(true);
  });

  it("a hostile query naming another user's membership id, inside withUser(userA), returns nothing", async () => {
    const rows = await withUser(userA, (tx) =>
      tx.select().from(tenantMemberships).where(eq(tenantMemberships.id, membershipB_X)),
    );
    expect(rows).toHaveLength(0);
  });

  it("a write inside withUser() against tenant_memberships is rejected, not silently permitted under some other policy", async () => {
    let caught: { code?: string; message?: string } = {};
    try {
      await withUser(userA, (tx) =>
        tx.insert(tenantMemberships).values({
          id: uuidv7(),
          tenantId: tenantY,
          userId: userA,
          roleId: roleXId, // wrong tenant's role on purpose — irrelevant, the RLS check must fire first
          status: "active",
        }),
      );
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      caught = { code: cause?.code, message: cause?.message };
    }
    // 42501 = insufficient_privilege, Postgres's code for a WITH CHECK/RLS
    // policy violation — not just "any throw".
    expect(caught.code).toBe("42501");
    expect(caught.message).toMatch(/row-level security/i);
  });

  it("a read inside withTenant() does not see rows the user-scoped policy would expose — ordinary tenant code is unaffected", async () => {
    const rows = await withTenant(tenantY, (tx) => tx.select().from(tenantMemberships));
    // Only tenantY's membership (userA's) is visible; userA's tenantX
    // membership must not leak in even though it belongs to the same user —
    // withTenant() never sets app.user_id, so the user_resolution branch of
    // the OR never contributes here.
    expect(rows.map((r) => r.id)).toEqual([membershipA_Y]);
    expect(rows.map((r) => r.id)).not.toContain(membershipA_X);
  });

  it("withUser() inside withTenant() throws — scopes must not nest", async () => {
    await expect(
      withTenant(tenantX, async () => {
        await withUser(userA, async () => {});
      }),
    ).rejects.toThrow(/must not nest/i);
  });

  it("withTenant() inside withUser() throws — scopes must not nest", async () => {
    await expect(
      withUser(userA, async () => {
        await withTenant(tenantX, async () => {});
      }),
    ).rejects.toThrow(/must not nest/i);
  });

  it("a role renamed AND re-keyed after seeding still routes correctly — home path/ordinal are data, not a role-key branch", async () => {
    // roleXId is currently key='owner', home_path='/owner'. Rename both the
    // display name and the key itself (nothing in the schema prevents it —
    // that absence of a constraint is exactly the risk F-04's rule guards
    // against) and confirm resolution is unaffected.
    await admin.query("update roles set name = 'Founder', key = 'founder-renamed' where id = $1", [roleXId]);

    const home = await resolveHomePath(`uscope-ba-a-${RUN}`);
    expect(home).toBe("/owner");

    const membership = await resolveDefaultMembership(`uscope-ba-a-${RUN}`);
    expect(membership?.tenantId).toBe(tenantX);
    expect(membership?.roleKey).toBe("founder-renamed");
  });
});
