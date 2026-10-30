// @vitest-environment node
//
// Lane c-money — the "collected" figure is GROSS (F-02), and the
// reversal is stated BESIDE it, ledger-only.
//
// The authoritative contract is not this lane's invention; it is the
// approved product contract in the baseline:
//   docs/design-system/screens.md (/owner/fees): "A reversal is
//   stated beside the total and is ledger-only: it is never netted
//   into the collected figure."
//   docs/design-system/flows.md O1: "A reversal is a separate,
//   explicit action (payments.refund), it is ledger-only, and it is
//   never netted into the collected total."
//
// So the collected figure is the GROSS of the captured counter
// payments, on every surface: the fees hub, the owner home chart, the
// daily collection report. The reversal total is stated separately,
// the ledger carries the reversal row, and the invoice's balance is
// corrected exactly.
//
// The Fees hub overview used to subtract the reversal total from the
// collected figure, so it disagreed with the home chart and the daily
// collection for the same period and with the contract.
//
// Fixture setup runs through the privileged pool; every assertion runs
// against the application's own services over the app_login connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";
import { recordPayment } from "@/lib/services/payments";
import { reversePayment } from "@/lib/services/payment-reversals";
import { getInvoice } from "@/lib/services/invoices";
import { getFeesOverview, listHubTransactionsPage } from "@/lib/services/fees-hub";
import { getDailyCollection } from "@/lib/services/reconciliation";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

const tenantId: TenantId = asTenantId(uuidv7());
const locationA = uuidv7();
const locationB = uuidv7();
const personA = uuidv7();
const memberA = uuidv7();
const planId = uuidv7();

let invoiceId = "";
let paymentId = "";
let userId = asUserId("");

const ctx = () => ({
  tenantId,
  userId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set([
    "reports.financial",
    "reports.operational",
    "payments.read",
    "payments.record",
    "payments.refund",
  ]),
});

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Gross Club', 'active', $3)",
    [tenantId, `gross-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $3, 'Site A', true), ($2, $3, 'Site B', false)",
    [locationA, locationB, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Gross Member')",
    [personA, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberA, tenantId, personA, locationA, `GROSS-${RUN}`],
  );
  await admin.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly', 'duration', 30, 100000)",
    [planId, tenantId, locationA],
  );
  userId = asUserId(randomUUID());
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9188${RUN}${String(1).padStart(3, "0")}`,
  ]);

  // A live invoice to collect against (fixture setup).
  invoiceId = uuidv7();
  const today = todayInZone(TZ);
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 100000, 0, 100000, 0, 'issued')`,
    [invoiceId, tenantId, locationA, memberA, `INV${RUN.slice(-10)}`, today],
  );

  const payment = await recordPayment(ctx(), {
    invoiceId,
    amountPaise: 100000,
    method: "cash",
  });
  expect(payment.ok).toBe(true);
  if (payment.ok) paymentId = payment.id;

  const reversal = await reversePayment(ctx(), {
    paymentId,
    amountPaise: 30000,
    reason: "Part refunded in cash",
  });
  expect(reversal.ok).toBe(true);
}, 120_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from payment_reversals where tenant_id = $1", [
    tenantId,
  ]);
  await admin.query("delete from payments where tenant_id = $1", [tenantId]);
  await admin.query("delete from invoices where tenant_id = $1", [tenantId]);
  await admin.query("delete from membership_plans where tenant_id = $1", [
    tenantId,
  ]);
  await admin.query("delete from members where tenant_id = $1", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.query("delete from users where phone like $1", [`+9188${RUN}%`]);
  await admin.end();
});

describe("the collected figure is gross; a reversal is ledger-only (F-02)", () => {
  it("states the reversal beside the collected figure instead of netting it out", async () => {
    const today = todayInZone(TZ);
    const overview = await getFeesOverview(ctx(), {
      from: today,
      to: addDays(today, 1),
    });

    // GROSS: 100000 captured at the counter.
    expect(overview.collectedPaise).toBe(100000);
    // The reversal is stated SEPARATELY.
    expect(overview.reversedPaise).toBe(30000);
    expect(overview.reversalCount).toBe(1);
    // And the payment count is the count of captured payments.
    expect(overview.paymentCount).toBe(1);
  }, 60_000);

  it("agrees with the owner home chart and the daily collection report", async () => {
    const today = todayInZone(TZ);
    const overview = await getFeesOverview(ctx(), {
      from: today,
      to: addDays(today, 1),
    });
    const charts = await getOwnerCharts(ctx(), { period: "day" });
    const daily = await getDailyCollection(ctx(), { onDate: today });

    expect(charts.collections.totalPaise).toBe(overview.collectedPaise);
    expect(daily.totalPaise).toBe(overview.collectedPaise);
    // The home chart states the reversal beside the total too.
    expect(charts.collections.reversedPaise).toBe(overview.reversedPaise);
  }, 60_000);

  it("keeps the ledger's own row arithmetic, with the reversal as its own row", async () => {
    const today = todayInZone(TZ);
    const period = { from: today, to: addDays(today, 1) };
    const overview = await getFeesOverview(ctx(), period);
    const page = await listHubTransactionsPage(ctx(), period);

    const paymentRows = page.rows.filter((row) => row.kind === "payment");
    const reversalRows = page.rows.filter((row) => row.kind === "reversal");
    expect(paymentRows.reduce((sum, row) => sum + row.amountPaise, 0)).toBe(
      100000,
    );
    expect(reversalRows).toHaveLength(1);
    expect(reversalRows[0]).toMatchObject({
      amountPaise: -30000,
      reason: "Part refunded in cash",
    });

    // The LEDGER nets its own rows; the COLLECTED figure stays gross.
    const ledgerTotal = page.rows.reduce((sum, row) => sum + row.amountPaise, 0);
    expect(ledgerTotal).toBe(70000);
    expect(overview.collectedPaise).toBe(overview.reversedPaise + ledgerTotal);

    // The page is complete: nothing was left out.
    expect(page.truncated).toBe(false);
    expect(page.totalCount).toBe(2);
    expect(page.rows).toHaveLength(2);
  }, 60_000);

  it("corrects the invoice balance exactly", async () => {
    const invoice = await getInvoice(ctx(), invoiceId);
    expect(invoice).not.toBeNull();
    expect(invoice!.paidPaise).toBe(70000);
    expect(invoice!.outstandingPaise).toBe(30000);
    expect(invoice!.status).toBe("partial");
  }, 60_000);

  it("attributes a late-night payment to the tenant-local day, not the UTC day", async () => {
    // 2026-10-02 00:00 IST exactly = 2026-10-01 18:30 UTC. The IST day
    // owns it; a UTC-day window would file it under the 1st.
    const at = zonedWallTimeToInstant("2026-10-02", "00:00", TZ);
    const paymentId2 = uuidv7();
    await admin.query(
      `insert into payments (id, tenant_id, member_id, location_id, amount_paise, method, received_at, status)
       values ($1, $2, $3, $4, 5000, 'cash', $5, 'captured')`,
      [paymentId2, tenantId, memberA, locationA, at],
    );
    try {
      const second = await getDailyCollection(ctx(), { onDate: "2026-10-02" });
      const first = await getDailyCollection(ctx(), { onDate: "2026-10-01" });
      expect(second.totalPaise).toBe(5000);
      expect(first.totalPaise).toBe(0);

      const overview = await getFeesOverview(ctx(), {
        from: "2026-10-02",
        to: "2026-10-03",
      });
      expect(overview.collectedPaise).toBe(5000);
    } finally {
      await admin.query("delete from payments where id = $1", [paymentId2]);
    }
  }, 60_000);
});
