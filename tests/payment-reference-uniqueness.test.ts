import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";

// C-33 bug fix — a live-attack audit found that `payments.reference`
// (the UPI UTR / bank transaction reference entered at the counter)
// had no uniqueness constraint. Two different invoices were paid live
// using the identical UPI reference "DUPTEST123" and both succeeded:
// the same real-world UPI receipt could be used to justify two
// different payments. This test proves two payments against
// *different* invoices with the same (method, reference) are
// rejected — first for 'upi', then again for 'bank_transfer' as the
// same-shaped second instance.

type InvoiceMutations = typeof import("@/lib/services/invoice-mutations");
type Payments = typeof import("@/lib/services/payments");
type Roles = typeof import("@/lib/services/roles");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let mutations: InvoiceMutations;
let payments: Payments;

const tenantA = asTenantId(uuidv7());
const desk1 = asUserId(uuidv7());
const locA = uuidv7();
const facilityA = uuidv7();
const personMember = uuidv7();
const personDesk1 = uuidv7();
const memberA = asMemberId(uuidv7());
const planA = uuidv7();
const planB = uuidv7();
const planC = uuidv7();
const planD = uuidv7();
const subA = uuidv7();
const subB = uuidv7();
const subC = uuidv7();
const subD = uuidv7();
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const ctx1 = { tenantId: tenantA, userId: desk1 };

let invoiceIdA = "";
let invoiceIdB = "";
let invoiceIdC = "";
let invoiceIdD = "";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(adminUri);

  mutations = await import("@/lib/services/invoice-mutations");
  payments = await import("@/lib/services/payments");
  const roles: Roles = await import("@/lib/services/roles");

  admin = new Pool({ connectionString: adminUri });
  const today = todayInZone(TZ);
  const endsOn = addDays(today, 29);

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Ref Club', 'active', $3)`,
    [tenantA, `ref-${RUN}`, TZ],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Worli', true)`,
    [locA, tenantA],
  );
  await admin.query(
    "insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1, $2, $3, 'Main pool', 'pool', 24)",
    [facilityA, tenantA, locA],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values ($1, $3, 'Mira Member'), ($2, $3, 'Rhea Desk')`,
    [personMember, personDesk1, tenantA],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberA, tenantA, personMember, locA, `REF-${RUN}`],
  );
  // Four plans, one per subscription below: each subscription must be
  // its own (member, plan) pair now that only one active subscription
  // per (member, plan) is allowed.
  for (const [plan, name] of [
    [planA, "Monthly A"],
    [planB, "Monthly B"],
    [planC, "Monthly C"],
    [planD, "Monthly D"],
  ] as const) {
    await admin.query(
      "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, $4, 'duration', 30, 250000)",
      [plan, tenantA, locA, name],
    );
  }
  // Four subscriptions so four separate invoices can each be raised
  // (a subscription may hold only one live invoice per due date).
  for (const [sub, plan] of [
    [subA, planA],
    [subB, planB],
    [subC, planC],
    [subD, planD],
  ] as const) {
    await admin.query(
      "insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status) values ($1, $2, $3, $4, $5, $6, $7, 'active')",
      [sub, tenantA, memberA, plan, locA, today, endsOn],
    );
  }

  await roles.seedRoleTemplates(tenantA);
  const ownerRole = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1 and key = 'owner'",
    [tenantA],
  );
  const roleId = ownerRole.rows[0]!.id;
  const phone = String(Date.now()).slice(-8);
  await admin.query("insert into users (id, phone, person_id) values ($1, $2, $3)", [
    desk1,
    `+9194${phone}`,
    personDesk1,
  ]);
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
    [uuidv7(), tenantA, desk1, roleId],
  );

  const issuedA = await mutations.createInvoiceForSubscription(ctx1, { subscriptionId: subA });
  const issuedB = await mutations.createInvoiceForSubscription(ctx1, { subscriptionId: subB });
  const issuedC = await mutations.createInvoiceForSubscription(ctx1, { subscriptionId: subC });
  const issuedD = await mutations.createInvoiceForSubscription(ctx1, { subscriptionId: subD });
  expect(issuedA.ok).toBe(true);
  expect(issuedB.ok).toBe(true);
  expect(issuedC.ok).toBe(true);
  expect(issuedD.ok).toBe(true);
  if (issuedA.ok) invoiceIdA = issuedA.id;
  if (issuedB.ok) invoiceIdB = issuedB.id;
  if (issuedC.ok) invoiceIdC = issuedC.id;
  if (issuedD.ok) invoiceIdD = issuedD.id;
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("C-33 payment reference uniqueness", () => {
  it("refuses a second UPI payment on a different invoice with the identical reference", async () => {
    const first = await payments.recordPayment(ctx1, {
      invoiceId: invoiceIdA,
      amountPaise: 1000,
      method: "upi",
      reference: "DUPTEST123",
    });
    expect(first.ok).toBe(true);

    const second = await payments.recordPayment(ctx1, {
      invoiceId: invoiceIdB,
      amountPaise: 1000,
      method: "upi",
      reference: "DUPTEST123",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain("already been used");
    }
  });

  it("refuses a second bank_transfer payment on a different invoice with the identical reference", async () => {
    const first = await payments.recordPayment(ctx1, {
      invoiceId: invoiceIdC,
      amountPaise: 1000,
      method: "bank_transfer",
      reference: "NEFTDUP987",
    });
    expect(first.ok).toBe(true);

    const second = await payments.recordPayment(ctx1, {
      invoiceId: invoiceIdD,
      amountPaise: 1000,
      method: "bank_transfer",
      reference: "NEFTDUP987",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain("already been used");
    }
  });
});
