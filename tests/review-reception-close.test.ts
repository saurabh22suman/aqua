import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";

// M01/M02 regression — docs/audits/2026-10-09-role-content-permission-audit.md §11.
//
// M01: reception gets a narrow, current-day, assigned-location close read
// (payments.record), never reports.financial. M02: a read-only desk dues
// call list (invoices.read) scoped to the caller's locations. Both must
// exclude another location's money and carry no report/aggregate fields.

let container: StartedPostgreSqlContainer;
let admin: Pool;
let closeSummary: typeof import("@/lib/services/reconciliation-closed-state");
let reconciliation: typeof import("@/lib/services/reconciliation");
let feesHub: typeof import("@/lib/services/fees-hub");
let payments: typeof import("@/lib/services/payments");

const tenantId = asTenantId(randomUUID());
const ownerUserId = asUserId(randomUUID());
const receptionAUserId = asUserId(randomUUID());
const receptionBUserId = asUserId(randomUUID());
const locationA = randomUUID();
const locationB = randomUUID();
const memberA = randomUUID();
const memberB = randomUUID();

let invoiceA1 = "";
let invoiceA2 = "";
let invoiceA3 = "";
let invoiceB1 = "";

const owner = {
  tenantId,
  userId: ownerUserId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
};
const receptionA = {
  tenantId,
  userId: receptionAUserId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locationA],
  permissions: new Set(["payments.record", "invoices.read"]),
};
const receptionB = {
  tenantId,
  userId: receptionBUserId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locationB],
  permissions: new Set(["payments.record", "invoices.read"]),
};

let today = "";
let overdueDueOn = "";
let futureDueOn = "";

const CLOSE_KEYS = [
  "bankTransferPaise",
  "cashCount",
  "cashPaise",
  "closed",
  "locationId",
  "locationName",
  "methods",
  "paymentCount",
  "totalPaise",
  "upiPaise",
].sort();

const DUE_KEYS = [
  "dueOn",
  "id",
  "invoiceNumber",
  "memberCode",
  "memberName",
  "outstandingPaise",
  "overdue",
  "phone",
].sort();

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
  admin = new Pool({ connectionString: url });

  const { seedRoleTemplates } = await import("@/lib/services/roles");
  const { withTenant } = await import("@/db/tenant");
  const { issueInvoiceInTx } = await import("@/lib/services/invoice-issue");
  payments = await import("@/lib/services/payments");
  feesHub = await import("@/lib/services/fees-hub");
  reconciliation = await import("@/lib/services/reconciliation");
  closeSummary = await import("@/lib/services/reconciliation-closed-state");

  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'Review reception close','active','Asia/Kolkata')",
    [tenantId, `review-m01-${tenantId}`],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)",
    [locationA, locationB, tenantId],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    "insert into users(id,phone) values($1,$4),($2,$5),($3,$6)",
    [
      ownerUserId,
      receptionAUserId,
      receptionBUserId,
      "+919000007101",
      "+919000007102",
      "+919000007103",
    ],
  );
  const roleRows = await admin.query<{ id: string; key: string }>(
    "select id,key from roles where tenant_id=$1",
    [tenantId],
  );
  const receptionRoleId = (() => {
    const row = roleRows.rows.find((r) => r.key === "receptionist");
    if (!row) throw new Error("fixture: seeded receptionist role missing");
    return row.id;
  })();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  await admin.query(
    `insert into tenant_memberships(id,tenant_id,user_id,role_id,all_locations,status) values
       ($1,$3,$4,$7,true,'active'),
       ($2,$3,$5,$7,false,'active'),
       ($6,$3,$8,$7,false,'active')`,
    [
      randomUUID(),
      membershipA,
      tenantId,
      ownerUserId,
      receptionAUserId,
      membershipB,
      receptionRoleId,
      receptionBUserId,
    ],
  );
  await admin.query(
    `insert into membership_locations(id,tenant_id,membership_id,location_id) values
       ($1,$3,$4,$5),($2,$3,$6,$7)`,
    [
      randomUUID(),
      randomUUID(),
      tenantId,
      membershipA,
      locationA,
      membershipB,
      locationB,
    ],
  );

  const { v7: uuidv7 } = await import("uuid");
  await admin.query(
    `insert into config_values(id,key,scope_type,scope_id,tenant_id,value)
     values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')`,
    [uuidv7(), tenantId],
  );

  const personA = randomUUID();
  const personB = randomUUID();
  await admin.query(
    `insert into persons(id,tenant_id,full_name,phone,date_of_birth) values
       ($1,$3,'Synthetic A','+919000007201','2014-01-01'),
       ($2,$3,'Synthetic B','+919000007202','2014-01-01')`,
    [personA, personB, tenantId],
  );
  await admin.query(
    `insert into members(id,tenant_id,person_id,location_id,member_code,status) values
       ($1,$3,$4,$6,'A-100','active'),($2,$3,$5,$7,'B-200','active')`,
    [memberA, memberB, tenantId, personA, personB, locationA, locationB],
  );

  today = todayInZone("Asia/Kolkata");
  overdueDueOn = addDays(today, -10);
  futureDueOn = addDays(today, 7);

  const issueIn = async (
    memberId: string,
    locationId: string,
    issuedOn: string,
    dueOn: string,
    amountPaise: number,
  ) => {
    const result = await withTenant(tenantId, (tx) =>
      issueInvoiceInTx(
        tx,
        {
          tenantId,
          memberId,
          locationId,
          issuedOn,
          dueOn,
          lines: [{ description: "Monthly fees", amountPaise }],
        },
        ownerUserId,
      ),
    );
    if (!result.ok) throw new Error(`fixture: invoice issue failed: ${result.error}`);
    return result.invoiceId;
  };

  invoiceA1 = await issueIn(memberA, locationA, addDays(today, -30), overdueDueOn, 300000);
  invoiceA2 = await issueIn(memberA, locationA, addDays(today, -20), addDays(today, -5), 100000);
  invoiceA3 = await issueIn(memberA, locationA, today, futureDueOn, 80000);
  invoiceB1 = await issueIn(memberB, locationB, addDays(today, -15), addDays(today, -2), 300000);

  // A2 is fully settled (drops out of dues; status paid).
  await admin.query(
    "update invoices set status='paid', paid_paise=total_paise where id=$1",
    [invoiceA2],
  );

  const cashA = await payments.recordPayment(owner, {
    invoiceId: invoiceA1,
    amountPaise: 100000,
    method: "cash",
  });
  if (!cashA.ok) throw new Error(`fixture: cash A failed: ${cashA.error}`);
  const upiA = await payments.recordPayment(owner, {
    invoiceId: invoiceA1,
    amountPaise: 50000,
    method: "upi",
    reference: "UTR-M01-A",
  });
  if (!upiA.ok) throw new Error(`fixture: upi A failed: ${upiA.error}`);
  const cashB = await payments.recordPayment(owner, {
    invoiceId: invoiceB1,
    amountPaise: 200000,
    method: "cash",
  });
  if (!cashB.ok) throw new Error(`fixture: cash B failed: ${cashB.error}`);
}, 180_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("M01 — reception close-day summary", () => {
  it("returns only the caller's location, current-day method totals and no report fields", async () => {
    const summary = await closeSummary.getReceptionCloseSummary(receptionA);

    expect(summary.onDate).toBe(today);
    expect(Object.keys(summary).sort()).toEqual(["locations", "onDate"]);
    expect(summary.locations.map((l) => l.locationId)).toEqual([locationA]);

    const a = summary.locations[0]!;
    expect(a.locationName).toBe("A");
    expect(a.paymentCount).toBe(2);
    expect(a.totalPaise).toBe(150000);
    expect(a.cashPaise).toBe(100000);
    expect(a.upiPaise).toBe(50000);
    expect(a.bankTransferPaise).toBe(0);
    expect(a.closed).toBe(false);
    expect(a.cashCount).toBeNull();
    expect(a.methods.map((m) => m.key).sort()).toEqual(["cash", "upi"]);

    // No reports.financial shape leaks (by-staff, café split, dues totals).
    expect(Object.keys(a).sort()).toEqual(CLOSE_KEYS);
    expect(a).not.toHaveProperty("byStaff");
    expect(a).not.toHaveProperty("cafePaise");
    expect(a).not.toHaveProperty("outstandingPaise");
    expect(summary.locations.some((l) => l.locationId === locationB)).toBe(false);
  });

  it("closes A through the shared confirm path, shows the closed state, and refuses B", async () => {
    const result = await reconciliation.confirmCashCount(receptionA, {
      locationId: locationA,
      onDate: today,
      countedPaise: 100000,
    });
    expect(result).toMatchObject({ ok: true, variancePaise: 0 });

    const summary = await closeSummary.getReceptionCloseSummary(receptionA);
    const a = summary.locations[0]!;
    expect(a.closed).toBe(true);
    expect(a.cashCount).toMatchObject({
      countedPaise: 100000,
      systemPaise: 100000,
      variancePaise: 0,
      needsReview: false,
    });

    const denied = await reconciliation.confirmCashCount(receptionA, {
      locationId: locationB,
      onDate: today,
      countedPaise: 200000,
    });
    expect(denied.ok).toBe(false);
  });

  it("shows a B-only receptionist B's totals and an open state, not A's closed count", async () => {
    const summary = await closeSummary.getReceptionCloseSummary(receptionB);

    expect(summary.locations.map((l) => l.locationId)).toEqual([locationB]);
    const b = summary.locations[0]!;
    expect(b.paymentCount).toBe(1);
    expect(b.cashPaise).toBe(200000);
    expect(b.totalPaise).toBe(200000);
    expect(b.closed).toBe(false);
    expect(b.cashCount).toBeNull();
    expect(Object.keys(b).sort()).toEqual(CLOSE_KEYS);
  });
});

describe("M02 — desk dues queue", () => {
  it("lists only the caller's dues, overdue first, and drops a fully paid invoice", async () => {
    const dues = await feesHub.listDeskDues(receptionA);

    expect(dues.map((d) => d.id)).toEqual([invoiceA1, invoiceA3]);
    const [first, second] = dues;
    expect(first?.memberName).toBe("Synthetic A");
    expect(first?.memberCode).toBe("A-100");
    expect(first?.phone).toBe("+919000007201");
    expect(first?.outstandingPaise).toBe(150000);
    expect(first?.overdue).toBe(true);
    expect(first?.dueOn).toBe(overdueDueOn);
    expect(first?.invoiceNumber).toEqual(expect.any(String));
    expect(second?.outstandingPaise).toBe(80000);
    expect(second?.overdue).toBe(false);
    expect(second?.dueOn).toBe(futureDueOn);
    expect(Object.keys(first!).sort()).toEqual(DUE_KEYS);
    // The fully paid invoice (and B's invoice) never appear.
    expect(dues.some((d) => d.outstandingPaise === 0)).toBe(false);
    expect(dues.some((d) => d.memberCode === "B-200")).toBe(false);
  });

  it("shows a B-only receptionist B's dues only", async () => {
    const dues = await feesHub.listDeskDues(receptionB);
    expect(dues.map((d) => d.id)).toEqual([invoiceB1]);
    expect(dues[0]).toMatchObject({
      memberName: "Synthetic B",
      memberCode: "B-200",
      phone: "+919000007202",
      outstandingPaise: 100000,
      overdue: true,
    });
  });
});
