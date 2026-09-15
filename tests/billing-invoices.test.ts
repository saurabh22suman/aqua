import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";

// C-32 — invoices: arithmetic, GST snapshot per activity, tax invoice
// vs bill of supply, numbering, void rules, RLS.
// C-39 — receipts: generated once, stored against the payment,
// tenant-branded, deterministic.

type InvoiceMutations = typeof import("@/lib/services/invoice-mutations");
type InvoiceReads = typeof import("@/lib/services/invoices");
type Payments = typeof import("@/lib/services/payments");
type Receipts = typeof import("@/lib/services/receipts");
type ConfigAdmin = typeof import("@/db/config-admin");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let mutations: InvoiceMutations;
let reads: InvoiceReads;
let payments: Payments;
let receipts: Receipts;
let configAdmin: ConfigAdmin;

const tenantGst = asTenantId(uuidv7());
const tenantNoGst = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const actorId = asUserId(uuidv7());
const locGst = uuidv7();
const locNoGst = uuidv7();
const locB = uuidv7();
const poolGst = uuidv7();
const counterGst = uuidv7();
const person1 = uuidv7();
const person2 = uuidv7();
const personN = uuidv7();
const member1 = asMemberId(uuidv7());
const member2 = asMemberId(uuidv7());
const memberN = asMemberId(uuidv7());
const planAll = uuidv7();
const planCounter = uuidv7();
const planNoGst = uuidv7();
const subAll = uuidv7();
const subCounter = uuidv7();
const subNoGst = uuidv7();
const platformUserId = asUserId(uuidv7());
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const ctxGst = { tenantId: tenantGst, userId: actorId };
const ctxNoGst = { tenantId: tenantNoGst, userId: actorId };
const ctxB = { tenantId: tenantB, userId: actorId };

async function currentToday(): Promise<string> {
  return todayInZone(TZ);
}

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
  receipts = await import("@/lib/services/receipts");
  configAdmin = await import("@/db/config-admin");

  admin = new Pool({ connectionString: adminUri });
  const today = await currentToday();
  const endsOn = addDays(today, 29);

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, gstin) values
       ($1, $2, 'Aqua Test Club', 'active', $6, '27ABCDE1234F1Z5'),
       ($3, $4, 'No GST Club', 'active', $6, null),
       ($5, $7, 'Other Club', 'active', $6, null)`,
    [tenantGst, `gst-${RUN}`, tenantNoGst, `nogst-${RUN}`, tenantB, TZ, `other-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actorId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $4, 'Worli', true), ($2, $5, 'Bandra', true), ($3, $6, 'Elsewhere', true)`,
    [locGst, locNoGst, locB, tenantGst, tenantNoGst, tenantB],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $3, $4, 'Main pool', 'pool', 24),
       ($2, $3, $4, 'Café counter', 'counter', 1)`,
    [poolGst, counterGst, tenantGst, locGst],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $4, 'Asha Rao'), ($2, $4, 'Bela Shah'), ($3, $5, 'Cara Nair')`,
    [person1, person2, personN, tenantGst, tenantNoGst],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status) values
       ($1, $2, $3, $4, $5, 'active')`,
    [member1, tenantGst, person1, locGst, `GST-1-${RUN}`],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status) values
       ($1, $2, $3, $4, $5, 'active')`,
    [member2, tenantGst, person2, locGst, `GST-2-${RUN}`],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status) values
       ($1, $2, $3, $4, $5, 'active')`,
    [memberN, tenantNoGst, personN, locNoGst, `NG-1-${RUN}`],
  );
  await admin.query(
    `insert into membership_plans (id, tenant_id, location_id, activity_id, name, kind, duration_days, amount_paise)
     values
       ($1, $4, $5, null, 'Monthly all-access', 'duration', 30, 250000),
       ($2, $4, $5, $6, 'Monthly café', 'duration', 30, 250000),
       ($3, $7, $8, null, 'Monthly basic', 'duration', 30, 250000)`,
    [planAll, planCounter, planNoGst, tenantGst, locGst, counterGst, tenantNoGst, locNoGst],
  );
  await admin.query(
    `insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, activity_id, starts_on, ends_on, status, auto_renew)
     values
       ($1, $4, $5, $7, $9, null, $10, $11, 'active', false),
       ($2, $4, $6, $8, $9, $12, $10, $11, 'active', false),
       ($3, $13, $14, $15, $16, null, $10, $11, 'active', false)`,
    [
      subAll, subCounter, subNoGst,
      tenantGst, member1, member2,
      planAll, planCounter,
      locGst, today, endsOn,
      counterGst,
      tenantNoGst, memberN, planNoGst, locNoGst,
    ],
  );
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Billing Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `billing-${RUN}@platform.test`],
  );

  // Per-activity GST: the café counter carries 5%, everything else the
  // platform default (18%).
  const set = await configAdmin.setPlatformScopedConfigValue({
    tenantId: tenantGst,
    key: "billing.gst_rate_bp",
    value: 500,
    scope: { scopeType: "activity", scopeId: counterGst },
    actorId: platformUserId,
  });
  expect(set.ok).toBe(true);
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("C-32 invoice issue", () => {
  it("issues a tax invoice with resolved GST and the GSTIN snapshot", async () => {
    const result = await mutations.createInvoiceForSubscription(ctxGst, {
      subscriptionId: subAll,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoiceNumber).toBe("INV/2026-27/0001");

    const invoice = await reads.getInvoice(ctxGst, result.id);
    expect(invoice).not.toBeNull();
    if (!invoice) return;
    expect(invoice.documentKind).toBe("tax_invoice");
    expect(invoice.gstin).toBe("27ABCDE1234F1Z5");
    expect(invoice.locationId).toBe(locGst);
    expect(invoice.subscriptionId).toBe(subAll);
    expect(invoice.subtotalPaise).toBe(250000);
    expect(invoice.taxPaise).toBe(45000);
    expect(invoice.totalPaise).toBe(295000);
    expect(invoice.paidPaise).toBe(0);
    expect(invoice.outstandingPaise).toBe(295000);
    expect(invoice.status).toBe("issued");
    expect(invoice.memberName).toBe("Asha Rao");

    const line = invoice.lines[0]!;
    expect(line.description).toBe("Monthly all-access");
    expect(line.sacCode).toBe("999723");
    expect(line.amountPaise).toBe(250000);
    expect(line.taxRateBp).toBe(1800);
    expect(line.cgstPaise + line.sgstPaise).toBe(line.taxPaise);
    expect(line.cgstPaise).toBe(22500);
    expect(line.sgstPaise).toBe(22500);
  });

  it("applies the per-activity GST rate", async () => {
    const result = await mutations.createInvoiceForSubscription(ctxGst, {
      subscriptionId: subCounter,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoiceNumber).toBe("INV/2026-27/0002");

    const invoice = await reads.getInvoice(ctxGst, result.id);
    expect(invoice?.lines[0]?.taxRateBp).toBe(500);
    expect(invoice?.taxPaise).toBe(12500);
    expect(invoice?.totalPaise).toBe(262500);
  });

  it("issues a bill of supply with no tax for an unregistered tenant", async () => {
    const result = await mutations.createInvoiceForSubscription(ctxNoGst, {
      subscriptionId: subNoGst,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Its own series: numbering is per tenant.
    expect(result.invoiceNumber).toBe("INV/2026-27/0001");

    const invoice = await reads.getInvoice(ctxNoGst, result.id);
    expect(invoice?.documentKind).toBe("bill_of_supply");
    expect(invoice?.gstin).toBeNull();
    expect(invoice?.taxPaise).toBe(0);
    expect(invoice?.totalPaise).toBe(250000);
    expect(invoice?.lines[0]?.taxRateBp).toBe(0);
    expect(invoice?.lines[0]?.sacCode).toBe("999723");
  });

  it("lists a member's invoices", async () => {
    const list = await reads.listMemberInvoices(ctxGst, member1);
    expect(list).toHaveLength(1);
    expect(list[0]?.subscriptionId).toBe(subAll);
  });

  it("voids an unpaid invoice and refuses a second void", async () => {
    const list = await reads.listMemberInvoices(ctxGst, member1);
    const invoiceId = list[0]!.id;

    const first = await mutations.voidInvoice(ctxGst, invoiceId, "Raised in error");
    expect(first.ok).toBe(true);
    const after = await reads.getInvoice(ctxGst, invoiceId);
    expect(after?.status).toBe("void");

    const second = await mutations.voidInvoice(ctxGst, invoiceId, "Again");
    expect(second.ok).toBe(false);
  });

  it("keeps invoices tenant-isolated", async () => {
    const listB = await reads.listMemberInvoices(ctxB, member1);
    expect(listB).toEqual([]);
    const listForGst = await reads.listMemberInvoices(ctxGst, member2);
    expect(listForGst).toHaveLength(1);
    const crossTenant = await reads.getInvoice(ctxB, listForGst[0]!.id);
    expect(crossTenant).toBeNull();
  });
});

describe("C-39 receipts", () => {
  it("generates a branded PDF once and returns the stored copy after", async () => {
    const list = await reads.listMemberInvoices(ctxGst, member2);
    const invoiceId = list[0]!.id;
    const outstanding = list[0]!.outstandingPaise;

    const payment = await payments.recordPayment(ctxGst, {
      invoiceId,
      amountPaise: outstanding,
      method: "upi",
      reference: `UTR${RUN}`,
    });
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;

    const first = await receipts.getOrCreateReceipt(ctxGst, payment.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const text = first.pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("PAYMENT RECEIPT");
    expect(text).toContain("Aqua Test Club");
    expect(text).toContain("Tax Invoice");
    expect(text).toContain("Rs. ");
    expect(text).toContain("INV/2026-27/0002");
    expect(text).toContain("Two Thousand Six Hundred Twenty Five");
    expect(first.fileName).toBe("receipt-INV-2026-27-0002.pdf");

    const second = await receipts.getOrCreateReceipt(ctxGst, payment.id);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.pdf.equals(first.pdf)).toBe(true);

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from receipts where tenant_id = $1",
      [tenantGst],
    );
    expect(rows[0]?.count).toBe("1");

    const audit = await admin.query<{ count: string }>(
      "select count(*)::text as count from audit_log where tenant_id = $1 and action = 'receipt.generate'",
      [tenantGst],
    );
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("returns null for a payment in another tenant", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from payments where tenant_id = $1 limit 1",
      [tenantGst],
    );
    const notFound = await receipts.getOrCreateReceipt(ctxB, rows[0]!.id);
    expect(notFound.ok).toBe(false);
  });
});
