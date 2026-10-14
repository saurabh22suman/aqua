import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";

// R01 regression — issuing invoices must not also grant void authority.
// Void requires `settings.manage` (seeded Owner/Admin only); a
// receptionist holds `invoices.write` but must be refused, and a
// refusal must leave the invoice untouched with no `invoice.void`
// audit row.
// See docs/audits/2026-10-09-role-content-permission-audit.md §R01.

type InvoiceMutations = typeof import("@/lib/services/invoice-mutations");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let mutations: InvoiceMutations;

const tenantId = asTenantId(randomUUID());
const ownerUserId = asUserId(randomUUID());
const adminUserId = asUserId(randomUUID());
const receptionUserId = asUserId(randomUUID());

const locationA = randomUUID();
const memberId = randomUUID();

const owner = {
  tenantId,
  userId: ownerUserId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
};
const unrestrictedAdmin = {
  tenantId,
  userId: adminUserId,
  roleKey: "admin",
  allLocations: true,
  locationIds: [],
};
const reception = {
  tenantId,
  userId: receptionUserId,
  roleKey: "receptionist",
  allLocations: true,
  locationIds: [],
};

let refusedVoidInvoice = "";
let ownerVoidInvoice = "";
let adminVoidInvoice = "";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  process.env.DATABASE_URL = `postgresql://app_login:review-tests@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = "review-tests";
  const url = container.getConnectionUri();
  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, "review-tests");
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);
  const { seedRoleTemplates } = await import("@/lib/services/roles");
  const { withTenant } = await import("@/db/tenant");
  const { issueInvoiceInTx } = await import("@/lib/services/invoice-issue");
  mutations = await import("@/lib/services/invoice-mutations");

  admin = new Pool({ connectionString: url });
  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'Review R01','active','Asia/Kolkata')",
    [tenantId, `review-r01-${tenantId}`],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$2,'A',true)",
    [locationA, tenantId],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    "insert into users(id,phone) values($1,$4),($2,$5),($3,$6)",
    [
      ownerUserId,
      adminUserId,
      receptionUserId,
      "+919000008101",
      "+919000008102",
      "+919000008103",
    ],
  );
  const roleRows = await admin.query<{ id: string; key: string }>(
    "select id,key from roles where tenant_id=$1",
    [tenantId],
  );
  const roleId = (key: string) => {
    const row = roleRows.rows.find((r) => r.key === key);
    if (!row) throw new Error(`fixture: seeded role '${key}' missing`);
    return row.id;
  };
  await admin.query(
    `insert into tenant_memberships(id,tenant_id,user_id,role_id,all_locations,status) values
       ($1,$4,$5,$8,true,'active'),
       ($2,$4,$6,$9,true,'active'),
       ($3,$4,$7,$10,true,'active')`,
    [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      tenantId,
      ownerUserId,
      adminUserId,
      receptionUserId,
      roleId("owner"),
      roleId("admin"),
      roleId("receptionist"),
    ],
  );
  const personId = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$2,'Synthetic R01','1990-01-01')",
    [personId, tenantId],
  );
  await admin.query(
    "insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,'R01','active')",
    [memberId, tenantId, personId, locationA],
  );

  const issue = async (description: string) => {
    const result = await withTenant(tenantId, (tx) =>
      issueInvoiceInTx(
        tx,
        {
          tenantId,
          memberId,
          locationId: locationA,
          issuedOn: "2026-10-01",
          dueOn: "2026-10-01",
          lines: [{ description, amountPaise: 250000 }],
        },
        ownerUserId,
      ),
    );
    if (!result.ok) {
      throw new Error(`fixture: invoice issue failed: ${result.error}`);
    }
    return result.invoiceId;
  };
  refusedVoidInvoice = await issue("Monthly fees (reception attempt)");
  ownerVoidInvoice = await issue("Monthly fees (owner void)");
  adminVoidInvoice = await issue("Monthly fees (admin void)");
}, 120_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("R01 invoice void authority", () => {
  it("pins the seeded grant premise: reception has invoices.write but not settings.manage", async () => {
    const rows = await admin.query<{ key: string; permission_key: string }>(
      `select r.key, rp.permission_key from roles r
         join role_permissions rp on rp.role_id = r.id
        where r.tenant_id = $1
          and rp.permission_key in ('invoices.write', 'settings.manage')`,
      [tenantId],
    );
    const grants = (key: string) =>
      rows.rows.filter((r) => r.key === key).map((r) => r.permission_key);
    expect(grants("receptionist")).toContain("invoices.write");
    expect(grants("receptionist")).not.toContain("settings.manage");
    expect(grants("owner")).toEqual(
      expect.arrayContaining(["invoices.write", "settings.manage"]),
    );
    expect(grants("admin")).toEqual(
      expect.arrayContaining(["invoices.write", "settings.manage"]),
    );
  });

  it("refuses a receptionist void and leaves the invoice unchanged with no invoice.void audit", async () => {
    const before = (
      await admin.query("select * from invoices where id=$1", [
        refusedVoidInvoice,
      ])
    ).rows;

    const result = await mutations.voidInvoice(
      reception,
      refusedVoidInvoice,
      "Reception cancellation attempt",
    );

    expect(result.ok).toBe(false);

    const after = (
      await admin.query("select * from invoices where id=$1", [
        refusedVoidInvoice,
      ])
    ).rows;
    expect(after).toEqual(before);
    expect(after[0]?.status).toBe("issued");

    const audits = await admin.query(
      "select id from audit_log where tenant_id=$1 and entity_id=$2 and action='invoice.void'",
      [tenantId, refusedVoidInvoice],
    );
    expect(audits.rows).toEqual([]);
  });

  it("allows an owner to void an unpaid issued invoice, with invoice.void audit", async () => {
    const result = await mutations.voidInvoice(
      owner,
      ownerVoidInvoice,
      "Raised in error",
    );
    expect(result.ok).toBe(true);

    const row = await admin.query<{ status: string }>(
      "select status from invoices where id=$1",
      [ownerVoidInvoice],
    );
    expect(row.rows[0]?.status).toBe("void");

    const audits = await admin.query<{ actor_id: string; action: string }>(
      "select actor_id, action from audit_log where tenant_id=$1 and entity_id=$2 and action='invoice.void'",
      [tenantId, ownerVoidInvoice],
    );
    expect(audits.rows).toEqual([
      { actor_id: ownerUserId, action: "invoice.void" },
    ]);
  });

  it("allows an unrestricted admin to void an unpaid issued invoice, with invoice.void audit", async () => {
    const result = await mutations.voidInvoice(
      unrestrictedAdmin,
      adminVoidInvoice,
      "Raised in error",
    );
    expect(result.ok).toBe(true);

    const row = await admin.query<{ status: string }>(
      "select status from invoices where id=$1",
      [adminVoidInvoice],
    );
    expect(row.rows[0]?.status).toBe("void");

    const audits = await admin.query<{ actor_id: string }>(
      "select actor_id from audit_log where tenant_id=$1 and entity_id=$2 and action='invoice.void'",
      [tenantId, adminVoidInvoice],
    );
    expect(audits.rows).toEqual([{ actor_id: adminUserId }]);
  });
});
