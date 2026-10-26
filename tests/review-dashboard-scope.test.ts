import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// Regression evidence for docs/audits/2026-10-09-role-content-permission-audit.md
// A07 (restricted manager dashboard exposes other locations). The action
// (lib/actions/dashboard.ts:32-39) currently passes only tenantId into the
// service; this file pins the service contract the action must preserve:
// a restricted caller sees only resolveLocationAccess-derived locations on
// aggregates, lanes, breakdown and attention; an unrestricted owner sees all.
//
// RED against current HEAD: lib/services/dashboard.ts never consults
// ctx.allLocations / ctx.locationIds (only the optional options.locationId).

type ReviewCtx = ActionCtx & { permissions: Set<string> };

let container: StartedPostgreSqlContainer;
let admin: Pool;
let dashboard: typeof import("@/lib/services/dashboard");

const tenantId = asTenantId(randomUUID());
const locA = randomUUID();
const locB = randomUUID();
const TIMEZONE = "Asia/Kolkata";
const today = todayInZone(TIMEZONE);

const adminUserId = asUserId(randomUUID());
const ownerUserId = asUserId(randomUUID());

const programId = randomUUID();
const batchA = randomUUID();
const batchB = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();
const personA = randomUUID();
const personB = randomUUID();
const memberA = randomUUID();
const memberB = randomUUID();

const restrictedAdmin: ReviewCtx = {
  tenantId,
  userId: adminUserId,
  roleKey: "admin",
  allLocations: false,
  locationIds: [locA],
  permissions: new Set(["dashboard.view"]),
};

const unrestrictedOwner: ReviewCtx = {
  tenantId,
  userId: ownerUserId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
  permissions: new Set(["dashboard.view"]),
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const appPassword = "review-dashboard-scope";
  process.env.DATABASE_URL = `postgresql://app_login:${appPassword}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;
  const url = container.getConnectionUri();
  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);

  admin = new Pool({ connectionString: url });
  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'RD Dashboard Scope','active',$3)",
    [tenantId, `rd-dashboard-${tenantId}`, TIMEZONE],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A site',true),($2,$3,'B site',false)",
    [locA, locB, tenantId],
  );
  await admin.query(
    "insert into users(id, phone) values ($1,'+919820700101'),($2,'+919820700102')",
    [adminUserId, ownerUserId],
  );
  await admin.query(
    "insert into programs(id,tenant_id,name) values($1,$2,'RD Program')",
    [programId, tenantId],
  );

  await admin.query(
    "insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$2,'RD Member B','1990-01-01')",
    [personB, tenantId],
  );
  await admin.query(
    "insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,'RD-B','active')",
    [memberB, tenantId, personB, locB],
  );
  await admin.query(
    "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values($1,$2,$3,$4,'B-site batch',20,'07:00','08:00')",
    [batchB, tenantId, programId, locB],
  );
  await admin.query(
    "insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",
    [sessionB, tenantId, batchB, locB, today, new Date(Date.now() - 60 * 60 * 1000), new Date()],
  );
  await admin.query(
    "insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,$5)",
    [randomUUID(), tenantId, memberB, batchB, today],
  );
  await admin.query(
    "insert into cash_counts(id,tenant_id,location_id,on_date,counted_paise,system_paise,variance_paise,status,note) values($1,$2,$3,$4,460000,400000,60000,'closed','RD review synthetic')",
    [randomUUID(), tenantId, locB, today],
  );
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );

  dashboard = await import("@/lib/services/dashboard");
}, 240_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("review dashboard location scope (A07)", () => {
  it("A07 RED: a restricted admin gets no B-site counts, lanes, breakdown or attention", async () => {
    const allSites = await dashboard.getOwnerDashboard(restrictedAdmin, {});
    expect(allSites.activeMemberCount).toBe(0);
    expect(allSites.activeBatchCount).toBe(0);
    expect(allSites.todayTotal).toBe(0);
    expect(allSites.todayMarked).toBe(0);
    expect(allSites.todaysLanes.some((lane) => lane.batchId === batchB)).toBe(false);
    expect(allSites.facilityBreakdown.some((row) => row.locationId === locB)).toBe(false);
    expect(allSites.facilityBreakdown.some((row) => row.locationId === locA)).toBe(true);
    expect(allSites.needsAttention.some((item) => item.detail.includes("B-site batch"))).toBe(false);
    expect(allSites.needsAttention.some((item) => item.detail.includes("B site"))).toBe(false);

    const filteredB = await dashboard.getOwnerDashboard(restrictedAdmin, { locationId: locB });
    expect(filteredB.activeMemberCount).toBe(0);
    expect(filteredB.facilityBreakdown.some((row) => row.locationId === locB)).toBe(false);
    expect(filteredB.todaysLanes.some((lane) => lane.batchId === batchB)).toBe(false);
    expect(filteredB.needsAttention.some((item) => item.detail.includes("B site"))).toBe(false);
  });

  it("positive: a restricted admin sees only A; an unrestricted owner sees A and B", async () => {
    await admin.query(
      "insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$2,'RD Member A','1990-01-01')",
      [personA, tenantId],
    );
    await admin.query(
      "insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,'RD-A','active')",
      [memberA, tenantId, personA, locA],
    );
    await admin.query(
      "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values($1,$2,$3,$4,'A-site batch',20,'07:00','08:00')",
      [batchA, tenantId, programId, locA],
    );
    await admin.query(
      "insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",
      [sessionA, tenantId, batchA, locA, today, new Date(Date.now() - 60 * 60 * 1000), new Date()],
    );
    await admin.query(
      "insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,$5)",
      [randomUUID(), tenantId, memberA, batchA, today],
    );

    const ownerAll = await dashboard.getOwnerDashboard(unrestrictedOwner, {});
    expect(ownerAll.activeMemberCount).toBe(2);
    expect(ownerAll.activeBatchCount).toBe(2);
    expect(ownerAll.todayTotal).toBe(2);
    expect(ownerAll.facilityBreakdown.find((row) => row.locationId === locA)?.activeMembers).toBe(1);
    expect(ownerAll.facilityBreakdown.find((row) => row.locationId === locB)?.activeMembers).toBe(1);
    expect(ownerAll.todaysLanes.some((lane) => lane.batchId === batchB)).toBe(true);

    const scopedA = await dashboard.getOwnerDashboard(restrictedAdmin, {});
    expect(scopedA.activeMemberCount).toBe(1);
    expect(scopedA.activeBatchCount).toBe(1);
    expect(scopedA.todayTotal).toBe(1);
    expect(scopedA.facilityBreakdown.map((row) => row.locationId)).toEqual([locA]);
    expect(scopedA.facilityBreakdown[0]?.activeMembers).toBe(1);
    expect(scopedA.todaysLanes.some((lane) => lane.batchId === batchB)).toBe(false);
    expect(scopedA.needsAttention.some((item) => item.detail.includes("B site"))).toBe(false);

    const scopedAByFilter = await dashboard.getOwnerDashboard(restrictedAdmin, { locationId: locA });
    expect(scopedAByFilter.activeMemberCount).toBe(1);
    expect(scopedAByFilter.facilityBreakdown.map((row) => row.locationId)).toEqual([locA]);

    const ownerBOnly = await dashboard.getOwnerDashboard(unrestrictedOwner, { locationId: locB });
    expect(ownerBOnly.activeMemberCount).toBe(1);
    expect(ownerBOnly.facilityBreakdown.map((row) => row.locationId)).toEqual([locB]);
    expect(ownerBOnly.todaysLanes.some((lane) => lane.batchId === batchB)).toBe(true);
  });

  // C02 (docs/audits/2026-10-09-role-content-permission-audit.md §9) —
  // the owner home must lead with real billing figures. The service now
  // exposes collected-today / outstanding / overdue; every figure is
  // held to the same A07 location boundary as the rest of the dashboard.
  it("C02: exposes collected/outstanding/overdue money with the same site scope", async () => {
    // Self-sufficient fixtures: the EOW negative runs each test with
    // `-t`, so A-site member/person may not exist from the earlier test.
    await admin.query(
      "insert into persons(id, tenant_id, full_name, date_of_birth) values($1,$2,'RD Member A','1990-01-01') on conflict (id) do nothing",
      [personA, tenantId],
    );
    await admin.query(
      "insert into members(id, tenant_id, person_id, location_id, member_code, status) values($1,$2,$3,$4,'RD-A','active') on conflict (id) do nothing",
      [memberA, tenantId, personA, locA],
    );
    const yesterday = addDays(today, -1);
    const invoiceA = randomUUID();
    const invoiceB = randomUUID();
    // A: ₹1,000 overdue invoice + ₹1,000 cash captured today.
    await admin.query(
      "insert into invoices(id, tenant_id, location_id, member_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, paid_paise, status) values ($1,$2,$3,$4,'RD-C02-A','2026-27',$5,$5,100000,0,100000,0,'issued')",
      [invoiceA, tenantId, locA, memberA, yesterday],
    );
    await admin.query(
      "insert into payments(id, tenant_id, invoice_id, member_id, location_id, amount_paise, method, status, received_at) values ($1,$2,$3,$4,$5,100000,'cash','captured',now())",
      [randomUUID(), tenantId, invoiceA, memberA, locA],
    );
    // B: ₹2,500 overdue invoice + ₹500 UPI captured today.
    await admin.query(
      "insert into invoices(id, tenant_id, location_id, member_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, paid_paise, status) values ($1,$2,$3,$4,'RD-C02-B','2026-27',$5,$5,250000,0,250000,0,'issued')",
      [invoiceB, tenantId, locB, memberB, yesterday],
    );
    await admin.query(
      "insert into payments(id, tenant_id, invoice_id, member_id, location_id, amount_paise, method, status, received_at) values ($1,$2,$3,$4,$5,50000,'upi','captured',now())",
      [randomUUID(), tenantId, invoiceB, memberB, locB],
    );

    const ownerAll = await dashboard.getOwnerDashboard(unrestrictedOwner, {});
    expect(ownerAll.money.collectedTodayPaise).toBe(150000);
    expect(ownerAll.money.collectedTodayCount).toBe(2);
    expect(ownerAll.money.outstandingPaise).toBe(350000);
    expect(ownerAll.money.dueInvoiceCount).toBe(2);
    expect(ownerAll.money.overduePaise).toBe(350000);
    expect(ownerAll.money.overdueInvoiceCount).toBe(2);
    expect(ownerAll.needsAttention.some((item) => item.title === "Overdue fees")).toBe(true);

    const scopedA = await dashboard.getOwnerDashboard(restrictedAdmin, {});
    expect(scopedA.money.collectedTodayPaise).toBe(100000);
    expect(scopedA.money.collectedTodayCount).toBe(1);
    expect(scopedA.money.outstandingPaise).toBe(100000);
    expect(scopedA.money.dueInvoiceCount).toBe(1);
    expect(scopedA.money.overduePaise).toBe(100000);
    expect(scopedA.money.overdueInvoiceCount).toBe(1);
    expect(scopedA.needsAttention.some((item) => item.title === "Overdue fees")).toBe(true);
    expect(
      scopedA.needsAttention.some((item) => item.detail.includes("2,500")),
    ).toBe(false);

    // A facility choice can only narrow: a restricted A-site admin
    // asking for B gets honest zeroes, not B's money.
    const scopedAtoB = await dashboard.getOwnerDashboard(restrictedAdmin, {
      locationId: locB,
    });
    expect(scopedAtoB.money.collectedTodayPaise).toBe(0);
    expect(scopedAtoB.money.outstandingPaise).toBe(0);
    expect(scopedAtoB.money.overduePaise).toBe(0);
    expect(scopedAtoB.money.overdueInvoiceCount).toBe(0);
  });

  // C02 audit regression note — "cancelled/zero-roster session": a
  // cancelled session is not a lane and must not raise a register
  // decision, even when it has enrolments and already started.
  it("C02: a cancelled session is neither a lane nor a register decision", async () => {
    await admin.query(
      "insert into persons(id, tenant_id, full_name, date_of_birth) values($1,$2,'RD Member A','1990-01-01') on conflict (id) do nothing",
      [personA, tenantId],
    );
    await admin.query(
      "insert into members(id, tenant_id, person_id, location_id, member_code, status) values($1,$2,$3,$4,'RD-A','active') on conflict (id) do nothing",
      [memberA, tenantId, personA, locA],
    );
    const cancelledBatch = randomUUID();
    const cancelledSession = randomUUID();
    await admin.query(
      "insert into batches(id, tenant_id, program_id, location_id, name, capacity, start_time, end_time) values($1,$2,$3,$4,'RD Cancelled batch',10,'06:00','07:00')",
      [cancelledBatch, tenantId, programId, locA],
    );
    await admin.query(
      "insert into sessions(id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status) values($1,$2,$3,$4,$5,$6,$7,'cancelled')",
      [
        cancelledSession,
        tenantId,
        cancelledBatch,
        locA,
        today,
        new Date(Date.now() - 60 * 60 * 1000),
        new Date(),
      ],
    );
    await admin.query(
      "insert into enrolments(id, tenant_id, member_id, batch_id, enrolled_on) values($1,$2,$3,$4,$5)",
      [randomUUID(), tenantId, memberA, cancelledBatch, today],
    );

    const data = await dashboard.getOwnerDashboard(unrestrictedOwner, {});
    expect(data.todaysLanes.some((lane) => lane.batchId === cancelledBatch)).toBe(false);
    expect(
      data.needsAttention.some((item) => item.detail.includes("RD Cancelled batch")),
    ).toBe(false);
  });
});

// Owner Home composition, pinned as a source scan (the same shape the
// repo's kpi-label-size and date-display-sweep guards use).
//
// Superseded 2026-10-25 by the approved owner redesign. The first
// screen now leads with the figures (each label stating its basis),
// then the one dominant shortcut, then the 60/40 workspace (today's
// classes beside the exceptions), then the single trend panel. The
// honesty contracts survive: the money figure is today's captured
// total and says so, register state is never called attendance, and
// the phantom "Today's facilities" heading stays gone.
describe("owner Home composition and labels", () => {
  it("leads with the summary, then the dominant action, then the workspace, then one trend panel", () => {
    const src = readFileSync("components/owner-dashboard.tsx", "utf8");
    const summary = src.indexOf("Collected today");
    const action = src.indexOf("Collect payment");
    const attention = src.indexOf("Needs you today");
    const trend = src.indexOf("<OwnerHomeCharts");
    expect(summary).toBeGreaterThan(-1);
    expect(action).toBeGreaterThan(summary);
    expect(attention).toBeGreaterThan(action);
    expect(trend).toBeGreaterThan(attention);
    // The old gross-only label and the phantom facilities heading are gone.
    expect(src).not.toContain("Payments recorded today");
    expect(src).not.toContain("Today's facilities");
    // Completion is stated as marks recorded, never as attendance.
    expect(src).toContain("Register complete");
    expect(src).not.toContain("Attendance\u2019s");
  });
});
