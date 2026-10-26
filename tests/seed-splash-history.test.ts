import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { locations, programs } from "@/db/schema";
import { persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";
import { createMember } from "@/lib/services/register";
import { financialYearFor } from "@/lib/invoice-numbering";
import {
  applySplashHistory,
  assertLocalDatabase,
  planSplashHistory,
} from "@/db/seed-splash-history";
import { asTenantId, type TenantId } from "@/lib/ids";
import { privilegedFixturePool as admin } from "./db/privileged-fixture";

// Synthetic history: boundaries, determinism, idempotency and the
// accounting links. The planner is pure; the apply path runs against the
// disposable test DB on a private fixture tenant.

const NOW = new Date("2026-10-26T02:30:00+05:30").getTime();

describe("splash history planner", () => {
  const plan = planSplashHistory(NOW);

  it("covers the last three complete months plus the current month to date", () => {
    expect(plan.window.months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(plan.window.from).toBe("2026-07-01");
    expect(plan.window.to).toBe("2026-10-26");
  });

  it("never plans a future payment, session or attendance mark", () => {
    for (const invoice of plan.invoices) {
      expect(invoice.issuedOn <= plan.window.to).toBe(true);
      if (invoice.payment) {
        expect(Date.parse(invoice.payment.receivedAtIso)).toBeLessThanOrEqual(NOW);
      }
    }
    for (const session of plan.sessions) {
      expect(Date.parse(session.endIso)).toBeLessThanOrEqual(NOW);
      expect(Date.parse(session.markedAtIso)).toBeLessThanOrEqual(NOW);
    }
  });

  it("keeps invoices and payments reconciled and covers every method", () => {
    const statuses = plan.invoices.reduce<Record<string, number>>((acc, invoice) => {
      acc[invoice.status] = (acc[invoice.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(statuses).toEqual({ paid: 8, partial: 4, issued: 4 });
    for (const invoice of plan.invoices) {
      if (invoice.status === "paid") expect(invoice.paidPaise).toBe(invoice.totalPaise);
      if (invoice.status === "partial") {
        expect(invoice.paidPaise).toBeGreaterThan(0);
        expect(invoice.paidPaise).toBeLessThan(invoice.totalPaise);
      }
      if (invoice.status === "issued") expect(invoice.paidPaise).toBe(0);
      expect(invoice.payment?.amountPaise ?? 0).toBe(invoice.paidPaise);
    }
    const methods = new Set(plan.invoices.map((invoice) => invoice.payment?.method).filter(Boolean));
    expect([...methods].sort()).toEqual(["bank_transfer", "card", "cash", "upi"]);
  });

  it("marks most clinic sessions but deliberately leaves two unmarked", () => {
    expect(plan.sessions.length).toBe(17);
    expect(plan.sessions.every((session) => new Date(session.startIso).getUTCDay() === 6)).toBe(true);
    expect(plan.sessions.filter((session) => session.unmarked)).toHaveLength(2);
    const statuses = new Set(
      Array.from({ length: 8 }, (_, index) =>
        plan.attendanceFor(plan.sessions.find((session) => !session.unmarked)!, index),
      ),
    );
    expect(statuses.size).toBeGreaterThan(1);
  });

  it("is deterministic for the same clock", () => {
    expect(JSON.stringify(planSplashHistory(NOW))).toBe(JSON.stringify(planSplashHistory(NOW)));
  });

  it("drops events that have not happened yet when run earlier in the month", () => {
    const early = planSplashHistory(new Date("2026-10-05T02:00:00+05:30").getTime());
    for (const invoice of early.invoices) {
      expect(invoice.issuedOn <= "2026-10-05").toBe(true);
      if (invoice.payment) {
        expect(Date.parse(invoice.payment.receivedAtIso)).toBeLessThanOrEqual(
          new Date("2026-10-05T02:00:00+05:30").getTime(),
        );
      }
    }
  });

  // The financial year is a property of the INVOICE's issue date, not of
  // the seed run. A window that crosses the Indian financial-year
  // boundary (31 March / 1 April) produces invoices in two financial
  // years, and each one must carry its own.
  it("gives every planned invoice the financial year of its issue date", () => {
    const acrossBoundary = planSplashHistory(
      new Date("2027-04-05T09:30:00+05:30").getTime(),
    );
    const years = new Set(
      acrossBoundary.invoices.map((invoice) => invoice.financialYear),
    );
    expect(
      [...years].sort(),
      "a window crossing 31 March / 1 April must plan both financial years",
    ).toEqual(["2026-27", "2027-28"]);
    for (const invoice of acrossBoundary.invoices) {
      expect(invoice.financialYear).toBe(financialYearFor(invoice.issuedOn));
    }
  });

  it("keeps the financial year correct for a window inside one year", () => {
    const inside = planSplashHistory(NOW);
    for (const invoice of inside.invoices) {
      expect(invoice.financialYear).toBe(financialYearFor(invoice.issuedOn));
    }
    expect(new Set(inside.invoices.map((invoice) => invoice.financialYear))).toEqual(
      new Set(["2026-27"]),
    );
  });
});

describe("splash history guards", () => {
  it("refuses production and non-loopback databases", () => {
    expect(() => assertLocalDatabase("postgresql://x@db.example.com/aqua", "development")).toThrow(
      /not loopback/,
    );
    expect(() => assertLocalDatabase("postgresql://x@127.0.0.1:5432/aqua", "production")).toThrow(
      /production/,
    );
    expect(() => assertLocalDatabase("postgresql://x@localhost:5432/aqua", "development")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Apply path (disposable DB)
// ---------------------------------------------------------------------------

const RUN = Date.now().toString(36);
let tenantId: TenantId = asTenantId("");
let locationId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Splash History Test', 'Asia/Kolkata')",
    [tenantId, `splash-history-${RUN}`],
  );
  await withTenant(tenantId, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({ tenantId, name: "History Pool", isPrimary: true })
      .returning({ id: locations.id });
    locationId = location!.id;
    await tx.insert(programs).values({ tenantId, name: "Learn to swim" });
    const [person] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "History Coach" })
      .returning({ id: persons.id });
    await tx.insert(staff).values({
      tenantId,
      personId: person!.id,
      staffType: "coach",
      userId: null,
    });
  });
  for (let index = 0; index < 8; index++) {
    const created = await createMember(
      { tenantId },
      {
        fullName: `History Member ${index + 1}`,
        dateOfBirth: "1995-01-01",
        locationId,
        memberCode: `HIST-${RUN}-${index}`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } },
        ],
      },
    );
    if (!created.ok) throw new Error(created.error);
  }
}, 120_000);

afterAll(async () => {
  if (tenantId) {
    for (const table of [
      "attendance",
      "sessions",
      "enrolments",
      "payments",
      "invoices",
    ]) {
      await admin.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
    }
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from staff where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("splash history apply", () => {
  it("writes once, then adds zero duplicates on a repeat run", async () => {
    const first = await applySplashHistory({ tenantId, nowMs: NOW, apply: true, audit: false });
    expect(first.inserted.batch).toBe(1);
    expect(first.inserted.enrolments).toBe(8);
    expect(first.inserted.sessions).toBe(17);
    expect(first.inserted.invoices).toBe(16);
    expect(first.inserted.payments).toBe(12);
    expect(first.inserted.attendance).toBe(15 * 8);

    const second = await applySplashHistory({ tenantId, nowMs: NOW, apply: true, audit: false });
    expect(second.inserted).toEqual({
      batch: 0,
      enrolments: 0,
      sessions: 0,
      attendance: 0,
      invoices: 0,
      payments: 0,
    });
  }, 120_000);

  it("keeps invoice balances equal to their payments and capacity respected", async () => {
    const invoiceRows = await admin.query<{ n: string }>(
      `select count(*)::text n from invoices i
        where i.tenant_id = $1
          and i.paid_paise <> coalesce((select sum(p.amount_paise) from payments p
             where p.invoice_id = i.id and p.tenant_id = i.tenant_id and p.status = 'captured'), 0)`,
      [tenantId],
    );
    expect(invoiceRows.rows[0]!.n).toBe("0");

    const enrolmentRows = await admin.query<{ n: number }>(
      "select count(*)::int n from enrolments e join batches b on b.id = e.batch_id where e.tenant_id = $1 and b.name = 'Saturday Stroke Clinic'",
      [tenantId],
    );
    expect(enrolmentRows.rows[0]!.n).toBeLessThanOrEqual(12);

    const futureRows = await admin.query<{ n: number }>(
      "select count(*)::int n from payments where tenant_id = $1 and received_at > $2",
      [tenantId, new Date(NOW)],
    );
    expect(futureRows.rows[0]!.n).toBe(0);

    // Two genuinely unmarked completed sessions remain.
    const unmarked = await admin.query<{ n: number }>(
      `select count(*)::int n from sessions s
        where s.tenant_id = $1 and s.batch_id in (select id from batches where tenant_id = $1 and name = 'Saturday Stroke Clinic')
          and not exists (select 1 from attendance a where a.session_id = s.id)`,
      [tenantId],
    );
    expect(unmarked.rows[0]!.n).toBe(2);
  }, 120_000);

  it("reconciles monthly method totals with the recorded transactions", async () => {
    const query = await admin.query<{ month: string; method: string; paise: string }>(
      `select to_char(received_at at time zone 'Asia/Kolkata','YYYY-MM') mon, method,
              sum(amount_paise)::text paise
         from payments where tenant_id = $1 and status = 'captured'
         group by 1,2 order by 1,2`,
      [tenantId],
    );
    const rows = query.rows;
    const byMonth = new Map<string, number>();
    for (const row of rows) {
      byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + Number(row.paise));
    }
    const plan = planSplashHistory(NOW);
    const planned = new Map<string, number>();
    for (const invoice of plan.invoices) {
      if (!invoice.payment) continue;
      const month = invoice.payment.receivedAtIso.slice(0, 7);
      planned.set(month, (planned.get(month) ?? 0) + invoice.payment.amountPaise);
    }
    // IST month of the received timestamp can differ from the ISO slice at
    // month boundaries; compare the grand total and per-method instead.
    const total = [...byMonth.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(plan.invoices.reduce((sum, inv) => sum + (inv.payment?.amountPaise ?? 0), 0));
    const methodTotals = new Map<string, number>();
    for (const row of rows) {
      methodTotals.set(row.method, (methodTotals.get(row.method) ?? 0) + Number(row.paise));
    }
    for (const method of ["cash", "upi", "card", "bank_transfer"]) {
      expect(methodTotals.get(method) ?? 0).toBeGreaterThan(0);
    }
    expect(planned.size).toBeGreaterThan(0);
  }, 120_000);

  it("applies each invoice with the financial year of its own issue date, across the year boundary", async () => {
    // The same tenant, seeded with a clock in April 2027: the planned
    // window now crosses 31 March / 1 April, so the applied invoices
    // span TWO financial years and each row must carry its own.
    const acrossBoundary = new Date("2027-04-05T09:30:00+05:30").getTime();
    const applied = await applySplashHistory({
      tenantId,
      nowMs: acrossBoundary,
      apply: true,
      audit: false,
    });
    expect(applied.inserted.invoices).toBeGreaterThan(0);

    const rows = await admin.query<{ financial_year: string; issued_on: string }>(
      `select financial_year, issued_on::text from invoices
        where tenant_id = $1 and issued_on >= '2027-01-01'`,
      [tenantId],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect([...new Set(rows.rows.map((row) => row.financial_year))].sort()).toEqual([
      "2026-27",
      "2027-28",
    ]);
    for (const row of rows.rows) {
      expect(row.financial_year).toBe(financialYearFor(row.issued_on));
    }
  }, 120_000);
});
