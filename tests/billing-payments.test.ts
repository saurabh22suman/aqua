import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";

// C-33 — counter payments: partial payments settle an invoice, an
// overpayment is refused, concurrent recordings serialize under the
// invoice row lock, and every recording audits.
// C-34 — the daily collection report (by method and by staff) and the
// cash count confirmation with variance.

type InvoiceMutations = typeof import("@/lib/services/invoice-mutations");
type InvoiceReads = typeof import("@/lib/services/invoices");
type Payments = typeof import("@/lib/services/payments");
type Reconciliation = typeof import("@/lib/services/reconciliation");
type Roles = typeof import("@/lib/services/roles");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let mutations: InvoiceMutations;
let reads: InvoiceReads;
let payments: Payments;
let reconciliation: Reconciliation;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const desk1 = asUserId(uuidv7());
const desk2 = asUserId(uuidv7());
// No person record, no staff row: the report must fall back to the
// membership's role name rather than a phone number.
const desk3 = asUserId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const facilityA = uuidv7();
const personMember = uuidv7();
const personDesk1 = uuidv7();
const personDesk2 = uuidv7();
const memberA = asMemberId(uuidv7());
const planA = uuidv7();
const subA = uuidv7();
const subB = uuidv7();
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const ctx1 = { tenantId: tenantA, userId: desk1 };
const ctx2 = { tenantId: tenantA, userId: desk2 };
const ctx3 = { tenantId: tenantA, userId: desk3 };
const ctxB = { tenantId: tenantB, userId: desk1 };

let invoiceId = "";
let invoiceTotal = 0;

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
  reads = await import("@/lib/services/invoices");
  payments = await import("@/lib/services/payments");
  reconciliation = await import("@/lib/services/reconciliation");
  const roles: Roles = await import("@/lib/services/roles");

  admin = new Pool({ connectionString: adminUri });
  const today = todayInZone(TZ);
  const endsOn = addDays(today, 29);

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Pay Club', 'active', $5), ($3, $4, 'B Club', 'active', $5)`,
    [tenantA, `pay-${RUN}`, tenantB, `pay-b-${RUN}`, TZ],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Worli', true), ($2, $4, 'Elsewhere', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query(
    "insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1, $2, $3, 'Main pool', 'pool', 24)",
    [facilityA, tenantA, locA],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $4, 'Mira Member'), ($2, $4, 'Rhea Desk'), ($3, $4, 'Nikhil Desk')`,
    [personMember, personDesk1, personDesk2, tenantA],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberA, tenantA, personMember, locA, `PAY-${RUN}`],
  );
  await admin.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly', 'duration', 30, 250000)",
    [planA, tenantA, locA],
  );
  await admin.query(
    "insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status) values ($1, $2, $3, $4, $5, $6, $7, 'active')",
    [subA, tenantA, memberA, planA, locA, today, endsOn],
  );
  // A second subscription so the role-label test can raise its own
  // invoice (a subscription may hold only one live invoice per due
  // date).
  await admin.query(
    "insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status) values ($1, $2, $3, $4, $5, $6, $7, 'active')",
    [subB, tenantA, memberA, planA, locA, today, endsOn],
  );

  // Desk users with login identity, reached by the report through
  // tenant_memberships (db/CLAUDE.md's only sanctioned users path).
  await roles.seedRoleTemplates(tenantA);
  const ownerRole = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1 and key = 'owner'",
    [tenantA],
  );
  const roleId = ownerRole.rows[0]!.id;
  const phone = String(Date.now()).slice(-8);
  await admin.query(
    "insert into users (id, phone, person_id) values ($1, $2, $3), ($4, $5, $6), ($7, $8, null)",
    [
      desk1, `+9194${phone}`, personDesk1,
      desk2, `+9195${phone}`, personDesk2,
      desk3, `+9196${phone}`,
    ],
  );
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values
       ($1, $2, $3, $4, 'active'),
       ($5, $2, $6, $4, 'active'),
       ($7, $2, $8, $4, 'active')`,
    [uuidv7(), tenantA, desk1, roleId, uuidv7(), desk2, uuidv7(), desk3],
  );

  const issued = await mutations.createInvoiceForSubscription(ctx1, {
    subscriptionId: subA,
  });
  expect(issued.ok).toBe(true);
  if (issued.ok) {
    invoiceId = issued.id;
    const invoice = await reads.getInvoice(ctx1, issued.id);
    invoiceTotal = invoice?.totalPaise ?? 0;
  }
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("C-33 payments", () => {
  it("records a partial payment and moves the invoice to partial", async () => {
    const result = await payments.recordPayment(ctx1, {
      invoiceId,
      amountPaise: 100000,
      method: "cash",
    });
    expect(result.ok).toBe(true);
    const invoice = await reads.getInvoice(ctx1, invoiceId);
    expect(invoice?.paidPaise).toBe(100000);
    expect(invoice?.outstandingPaise).toBe(invoiceTotal - 100000);
    expect(invoice?.status).toBe("partial");
  });

  it("refuses an amount above the outstanding balance", async () => {
    const result = await payments.recordPayment(ctx1, {
      invoiceId,
      amountPaise: 250000,
      method: "cash",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outstanding");
    const invoice = await reads.getInvoice(ctx1, invoiceId);
    expect(invoice?.paidPaise).toBe(100000);
  });

  it("requires a reference for UPI and refuses one for cash", async () => {
    const noRef = await payments.recordPayment(ctx1, {
      invoiceId,
      amountPaise: 1000,
      method: "upi",
    });
    expect(noRef.ok).toBe(false);

    const cashWithRef = await payments.recordPayment(ctx1, {
      invoiceId,
      amountPaise: 1000,
      method: "cash",
      reference: "should not be here",
    });
    expect(cashWithRef.ok).toBe(false);
  });

  it("serializes concurrent recordings without losing money", async () => {
    const [first, second] = await Promise.all([
      payments.recordPayment(ctx1, {
        invoiceId,
        amountPaise: 50000,
        method: "cash",
      }),
      payments.recordPayment(ctx2, {
        invoiceId,
        amountPaise: 50000,
        method: "upi",
        reference: `UTR-A-${RUN}`,
      }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const invoice = await reads.getInvoice(ctx1, invoiceId);
    expect(invoice?.paidPaise).toBe(200000);
  });

  it("settles the invoice with the final payment and refuses more", async () => {
    const outstanding = (await reads.getInvoice(ctx1, invoiceId))!.outstandingPaise;
    const settle = await payments.recordPayment(ctx2, {
      invoiceId,
      amountPaise: outstanding,
      method: "bank_transfer",
      reference: `NEFT-${RUN}`,
    });
    expect(settle.ok).toBe(true);
    if (settle.ok) expect(settle.invoiceStatus).toBe("paid");

    const invoice = await reads.getInvoice(ctx1, invoiceId);
    expect(invoice?.outstandingPaise).toBe(0);
    expect(invoice?.status).toBe("paid");

    const over = await payments.recordPayment(ctx1, {
      invoiceId,
      amountPaise: 100,
      method: "cash",
    });
    expect(over.ok).toBe(false);
  });

  it("refuses to void an invoice that has payments", async () => {
    const result = await mutations.voidInvoice(ctx1, invoiceId, "Trying it on");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Payments");
  });

  it("audits every recorded payment", async () => {
    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from audit_log where tenant_id = $1 and action = 'payment.record'",
      [tenantA],
    );
    expect(rows[0]?.count).toBe("4");
  });
});

describe("C-34 daily collection report", () => {
  it("groups today's collections by method and by staff member", async () => {
    const onDate = todayInZone(TZ);
    const report = await reconciliation.getDailyCollection(ctx1, {
      onDate,
      locationId: locA,
    });

    expect(report.paymentCount).toBe(4);
    expect(report.totalPaise).toBe(invoiceTotal);
    expect(report.cashPaise).toBe(150000);

    const cash = report.byMethod.find((g) => g.key === "cash");
    expect(cash?.count).toBe(2);
    expect(cash?.totalPaise).toBe(150000);

    const upi = report.byMethod.find((g) => g.key === "upi");
    expect(upi?.count).toBe(1);

    const names = report.byStaff.map((g) => g.label).sort();
    expect(names).toEqual(["Nikhil Desk", "Rhea Desk"]);
    const rhea = report.byStaff.find((g) => g.label === "Rhea Desk");
    expect(rhea?.count).toBe(2);
    expect(rhea?.totalPaise).toBe(150000);
  });

  it("reports zeros for a day with nothing", async () => {
    const report = await reconciliation.getDailyCollection(ctx1, {
      onDate: "2020-01-01",
      locationId: locA,
    });
    expect(report.paymentCount).toBe(0);
    expect(report.totalPaise).toBe(0);
    expect(report.byMethod).toEqual([]);
  });

  it("confirms the cash count with a variance and replaces on recount", async () => {
    const onDate = todayInZone(TZ);
    const before = await reconciliation.getDailyCollection(ctx1, {
      onDate,
      locationId: locA,
    });
    expect(before.cashCount).toBeNull();

    const short = await reconciliation.confirmCashCount(ctx1, {
      locationId: locA,
      onDate,
      countedPaise: before.cashPaise - 10000,
      note: "Ten rupees short",
    });
    expect(short.ok).toBe(true);
    if (short.ok) {
      expect(short.systemPaise).toBe(150000);
      expect(short.variancePaise).toBe(-10000);
    }

    const after = await reconciliation.getDailyCollection(ctx1, {
      onDate,
      locationId: locA,
    });
    expect(after.cashCount?.variancePaise).toBe(-10000);
    expect(after.cashCount?.confirmedByName).toBe("Rhea Desk");

    const recount = await reconciliation.confirmCashCount(ctx2, {
      locationId: locA,
      onDate,
      countedPaise: before.cashPaise,
    });
    expect(recount.ok).toBe(true);
    if (recount.ok) expect(recount.variancePaise).toBe(0);

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from cash_counts where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("refuses to confirm a count for another tenant's location", async () => {
    const result = await reconciliation.confirmCashCount(ctxB, {
      locationId: locA,
      onDate: todayInZone(TZ),
      countedPaise: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("labels a receiver with no person record by their role, not a phone", async () => {
    const issued = await mutations.createInvoiceForSubscription(ctx1, {
      subscriptionId: subB,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const recorded = await payments.recordPayment(ctx3, {
      invoiceId: issued.id,
      amountPaise: 100,
      method: "cash",
    });
    expect(recorded.ok).toBe(true);

    const report = await reconciliation.getDailyCollection(ctx1, {
      onDate: todayInZone(TZ),
      locationId: locA,
    });
    const byRole = report.byStaff.find((g) => g.label === "Owner");
    expect(byRole?.count).toBe(1);
    expect(byRole?.totalPaise).toBe(100);
    expect(report.byStaff.some((g) => /^\+\d/.test(g.label))).toBe(false);
  });
});
