import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { locations, programs } from "@/db/schema";
import { batches } from "@/db/schema/programs";
import { members, persons } from "@/db/schema/people";
import { enrolments } from "@/db/schema/scheduling";
import { staff } from "@/db/schema/staff";
import { planShapes } from "@/db/schema/preset-engine";
import { createMember } from "@/lib/services/register";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { applyDemoHistory } from "@/scripts/demo-history/apply";
import { privilegedFixturePool as admin } from "./db/privileged-fixture";

// The apply path, end to end against the disposable test DB: the write
// lands, a repeat run adds nothing, the money balances, and the owner's
// own chart service agrees with the underlying rows.

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const ANCHOR = "2026-10-27";
const NOW_ISO = "2026-10-27T04:30:00.000Z";

let tenantId: TenantId = asTenantId("");
let locationId = "";

const owner = {
  userId: asUserId(randomUUID()),
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["dashboard.view", "reports.financial", "payments.read"]),
};

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  // The guard refuses anything that is not a demo tenant, so the fixture
  // IS the demo tenant (slug + name) — in the disposable test database
  // only.
  //
  // The fixture tenant carries a GSTIN on purpose: a tenant WITH a
  // GSTIN issues tax invoices, so the invoice total is the plan price
  // plus tax, and the generator has to scale the planned instalments to
  // that total. A tenant WITHOUT a GSTIN (the demo seed's case) never
  // exercises that branch, which is how a scaling bug can hide.
  await admin.query(
    "insert into tenants (id, slug, name, timezone, gstin) values ($1, $2, 'Aqua Worli', $3, $4)",
    [tenantId, `demo-academy`, TZ, "27AAPFU0939F1ZV"],
  );
  await withTenant(tenantId, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({ tenantId, name: "Worli Main", isPrimary: true })
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
    await tx.insert(planShapes).values([
      { tenantId, name: "Monthly", kind: "duration", durationDays: 30 },
      { tenantId, name: "Quarterly", kind: "duration", durationDays: 90 },
    ]);
    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.tenantId, tenantId))
      .limit(1);
    await tx.insert(batches).values({
      tenantId,
      programId: program!.id,
      name: "Morning Squad",
      capacity: 12,
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "07:00",
      endTime: "08:00",
      locationId,
      isSample: false,
    });
  });

  for (let index = 0; index < 12; index++) {
    const created = await createMember(
      { tenantId },
      {
        fullName: `History Member ${index + 1}`,
        dateOfBirth: "1990-01-01",
        locationId,
        memberCode: `HIST-${RUN}-${index}`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test" } },
        ],
      },
    );
    if (!created.ok) throw new Error(created.error);
  }

  // Enrol the members in the batch.
  await withTenant(tenantId, async (tx) => {
    const [batch] = await tx.select({ id: batches.id }).from(batches).limit(1);
    const memberRows = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.tenantId, tenantId))
      .orderBy(members.memberCode);
    for (const row of memberRows) {
      await tx.insert(enrolments).values({
        tenantId,
        memberId: row.id,
        batchId: batch!.id,
        enrolledOn: "2026-01-01",
      });
    }
  });
}, 120_000);

afterAll(async () => {
  if (tenantId) {
    for (const table of [
      // audit_log is append-only (E-03): a DELETE raises for every role,
      // so the trail stays in the disposable database.
      "enquiry_follow_ups",
      "enquiries",
      "attendance",
      "sessions",
      "enrolments",
      "payments",
      "invoice_line_items",
      "invoices",
      "invoice_number_counters",
      "subscriptions",
      "membership_plans",
      "plan_shapes",
      "batches",
      "consents",
      "members",
      "staff",
      "persons",
      "programs",
      "locations",
    ]) {
      await admin.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
    }
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
}, 120_000);

describe("demo history apply", () => {
  it("writes the history, then writes nothing on a repeat run", async () => {
    const first = await applyDemoHistory({
      tenantId,
      nowIso: NOW_ISO,
      anchorDate: ANCHOR,
      apply: true,
    });

    expect(first.mode).toBe("apply");
    expect(first.planned.sessions).toBeGreaterThan(0);
    expect(first.planned.marks).toBeGreaterThan(0);
    expect(first.planned.payments).toBeGreaterThan(0);
    expect(first.planned.invoices).toBeGreaterThan(0);
    expect(first.inserted.sessions).toBe(first.planned.sessions);
    expect(first.inserted.payments).toBe(first.planned.payments);
    expect(first.inserted.auditRows).toBeGreaterThan(0);

    const second = await applyDemoHistory({
      tenantId,
      nowIso: NOW_ISO,
      anchorDate: ANCHOR,
      apply: true,
    });
    expect(second.inserted.sessions).toBe(0);
    expect(second.inserted.marks).toBe(0);
    expect(second.inserted.payments).toBe(0);
    expect(second.inserted.invoices).toBe(0);
    expect(second.inserted.subscriptions).toBe(0);
    expect(second.inserted.enquiries).toBe(0);
    expect(second.inserted.plans).toBe(0);
    expect(second.existing.invoices).toBe(first.inserted.invoices);
  }, 180_000);

  it("keeps every invoice balanced against its payments", async () => {
    const unbalanced = await admin.query<{ n: string }>(
      `select count(*)::text n from invoices i
        where i.tenant_id = $1
          and i.paid_paise <> coalesce((select sum(p.amount_paise) from payments p
             where p.invoice_id = i.id and p.tenant_id = i.tenant_id and p.status = 'captured'), 0)`,
      [tenantId],
    );
    expect(unbalanced.rows[0]!.n).toBe("0");

    const overpaid = await admin.query<{ n: string }>(
      `select count(*)::text n from payments p
        where p.tenant_id = $1 and p.status = 'captured'
          and p.amount_paise > (select i.total_paise from invoices i where i.id = p.invoice_id)`,
      [tenantId],
    );
    expect(overpaid.rows[0]!.n).toBe("0");

    const statuses = await admin.query<{ status: string; n: string }>(
      `select status, count(*)::text n from invoices where tenant_id = $1 group by status order by status`,
      [tenantId],
    );
    const byStatus = Object.fromEntries(statuses.rows.map((row) => [row.status, Number(row.n)]));
    expect(byStatus.paid).toBeGreaterThan(0);
    expect(byStatus.partial).toBeGreaterThan(0);
    expect(byStatus.issued).toBeGreaterThan(0);
  }, 120_000);

  // The integration blocker this session was sent to fix: the invoice
  // carries GST on top of the plan price, so the planned instalments
  // have to be scaled to the invoice's REAL total. A part-paid invoice
  // must stay part-paid — the scaling may not turn "half paid" into
  // "fully paid" (and must not invent a paise either).
  it("keeps a part-paid invoice part-paid when the invoice carries GST", async () => {
    const taxed = await admin.query<{ n: string }>(
      `select count(*)::text n from invoices
        where tenant_id = $1 and tax_paise > 0`,
      [tenantId],
    );
    expect(Number(taxed.rows[0]!.n)).toBeGreaterThan(0);

    const partials = await admin.query<{
      total_paise: string;
      paid_paise: string;
      subtotal_paise: string;
    }>(
      `select total_paise::text, paid_paise::text, subtotal_paise::text
         from invoices
        where tenant_id = $1 and status = 'partial'`,
      [tenantId],
    );
    expect(partials.rows.length).toBeGreaterThan(0);

    for (const row of partials.rows) {
      const total = Number(row.total_paise);
      const paid = Number(row.paid_paise);
      // Part-paid means part-paid: strictly between nothing and the
      // whole invoice.
      expect(paid).toBeGreaterThan(0);
      expect(paid).toBeLessThan(total);
      // And the planned ratio survives the tax: the plan pays 40-70 %
      // of the price, so the paid share of the invoice stays in that
      // band (rounding aside).
      const ratio = paid / total;
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThan(0.8);
    }
  }, 120_000);

  it("never records money in the future and never outside the window", async () => {
    const future = await admin.query<{ n: string }>(
      `select count(*)::text n from payments where tenant_id = $1 and received_at > $2`,
      [tenantId, new Date(NOW_ISO)],
    );
    expect(future.rows[0]!.n).toBe("0");

    const outside = await admin.query<{ n: string }>(
      `select count(*)::text n from payments
        where tenant_id = $1 and status = 'captured'
          and (received_at at time zone 'Asia/Kolkata')::date < date '2026-07-30'`,
      [tenantId],
    );
    expect(outside.rows[0]!.n).toBe("0");
  }, 120_000);

  it("reconciles the summary with the rows in the database", async () => {
    const applied = await applyDemoHistory({
      tenantId,
      nowIso: NOW_ISO,
      anchorDate: ANCHOR,
      apply: true,
    });
    const reconciliation = applied.reconciliation!;
    expect(reconciliation.collections.totalPaise).toBeGreaterThan(0);

    const direct = await admin.query<{ paise: string; n: string }>(
      `select coalesce(sum(amount_paise), 0)::text paise, count(*)::text n
         from payments
        where tenant_id = $1 and status = 'captured'
          and received_at >= timestamptz '2026-07-30 00:00:00+05:30'
          and received_at <  timestamptz '2026-10-28 00:00:00+05:30'`,
      [tenantId],
    );
    expect(Number(direct.rows[0]!.paise)).toBe(reconciliation.collections.totalPaise);
    expect(Number(direct.rows[0]!.n)).toBe(reconciliation.collections.paymentCount);

    // The method split and the group split agree with each other.
    const groupTotal = Object.values(reconciliation.collections.byGroup).reduce(
      (sum, entry) => sum + entry.paise,
      0,
    );
    expect(groupTotal).toBe(reconciliation.collections.totalPaise);
    const methodTotal = Object.values(reconciliation.collections.byMethod).reduce(
      (sum, entry) => sum + entry.paise,
      0,
    );
    expect(methodTotal).toBe(reconciliation.collections.totalPaise);

    // Every method really occurs.
    expect(Object.keys(reconciliation.collections.byMethod).sort()).toEqual([
      "bank_transfer",
      "card",
      "cash",
      "other",
      "upi",
    ]);

    // The quiet days are real: some days carry no money at all.
    expect(reconciliation.collections.daysWithPayments).toBeGreaterThan(0);
    expect(reconciliation.collections.daysWithoutPayments).toBeGreaterThan(0);
    expect(reconciliation.collections.paymentsOutsideWindow).toBe(0);
  }, 180_000);

  it("agrees with the owner's own chart service", async () => {
    const applied = await applyDemoHistory({
      tenantId,
      nowIso: NOW_ISO,
      anchorDate: ANCHOR,
      apply: true,
    });
    const reconciliation = applied.reconciliation!;
    const charts = await getOwnerCharts(
      { tenantId, ...owner },
      { period: "month", now: Date.parse(NOW_ISO) },
    );

    // The chart reads the current month-to-date; the summary reads the
    // whole window. The month's slice of the summary must equal the
    // chart's total, to the paisa.
    const monthPrefix = ANCHOR.slice(0, 7);
    const monthPaise = reconciliation.collections.byDay
      .filter((day) => day.date.startsWith(monthPrefix))
      .reduce((sum, day) => sum + day.paise, 0);
    const monthCount = reconciliation.collections.byDay
      .filter((day) => day.date.startsWith(monthPrefix))
      .reduce((sum, day) => sum + day.count, 0);
    expect(charts.collections.totalPaise).toBe(monthPaise);
    expect(charts.collections.paymentCount).toBe(monthCount);

    // The doughnut's groups add up to the same figure.
    const groupTotal = charts.collections.groups.reduce((sum, group) => sum + group.paise, 0);
    expect(groupTotal).toBe(charts.collections.totalPaise);

    // Attendance: the chart's marks are the rows the summary counts.
    const monthMarks = reconciliation.attendance.byDay
      .filter((day) => day.date.startsWith(monthPrefix))
      .reduce((sum, day) => sum + day.marks, 0);
    const monthPresent = reconciliation.attendance.byDay
      .filter((day) => day.date.startsWith(monthPrefix))
      .reduce((sum, day) => sum + day.present, 0);
    expect(charts.attendance.total).toBe(monthMarks);
    expect(charts.attendance.present).toBe(monthPresent);
    expect(charts.attendance.pct).toBe(
      monthMarks > 0 ? Math.round((monthPresent / monthMarks) * 100) : null,
    );
  }, 180_000);

  it("leaves an audit trail for the money it wrote", async () => {
    const audit = await admin.query<{ action: string; n: string }>(
      `select action, count(*)::text n from audit_log
        where tenant_id = $1 group by action order by action`,
      [tenantId],
    );
    const byAction = Object.fromEntries(audit.rows.map((row) => [row.action, Number(row.n)]));
    expect(byAction["seed.demo_history"]).toBe(1);
    expect(byAction["invoice.issue"]).toBeGreaterThan(0);
    expect(byAction["payment.record"]).toBeGreaterThan(0);
    expect(byAction["subscription.create"]).toBeGreaterThan(0);
  }, 120_000);
});
