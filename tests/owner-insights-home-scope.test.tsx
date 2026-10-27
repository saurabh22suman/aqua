// @vitest-environment jsdom
//
// Owner Home — the insights section under a facility filter.
//
// The negative test this file exists for: a facility-scoped read must
// return — and the section must RENDER — only that facility's numbers.
// A page that shows "Splash Pool" above a batch list that also carries
// another site's batch is a scope leak dressed as a chart.
//
// The fixture is one tenant with two locations:
//
//   Splash Pool  → "Alpha Squad" (a session, a mark) + 1 new enquiry
//   Marina Pool  → "Beta Squad"  (a session, a mark) + 1 converted enquiry
//
// The unscoped read carries BOTH. The scoped read carries only Splash
// Pool's. The section renders the scoped read, so the other site's
// batch name and its enquiry must not appear anywhere on the screen.
//
// Everything runs against a THROWAWAY Postgres 16 container with the
// real migrations (tests/helpers/isolated-db), through the app pool
// (app_login, tenant RLS), so the scoping predicates are exercised as
// they ship. No privileged URL of the ambient database is referenced.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { cleanup, render } from "@testing-library/react";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";
import type { ActionCtx } from "@/lib/auth/context";
import type {
  AttendanceByBatchInsight,
  EnquiryStageInsight,
} from "@/lib/services/owner-insights";
import { addDays, todayInZone } from "@/lib/time/tz";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

let db: IsolatedDb;
let admin: Pool;

type AttendanceFn = (ctx: ActionCtx, raw: unknown) => Promise<AttendanceByBatchInsight>;
type EnquiryFn = (ctx: ActionCtx, raw: unknown) => Promise<EnquiryStageInsight>;
let getAttendanceByBatch: AttendanceFn;
let getEnquiryStageBreakdown: EnquiryFn;

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let poolLocationId = "";
let marinaLocationId = "";

const owner: ActionCtx = {
  tenantId: asTenantId(""),
  userId: asUserId(randomUUID()),
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
  permissions: new Set(["reports.operational", "enquiries.read", "settings.manage"]),
};

async function insertLocation(tenant: TenantId, name: string, isPrimary: boolean) {
  const id = randomUUID();
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, $3, $4)",
    [id, tenant, name, isPrimary],
  );
  return id;
}

async function insertMember(tenant: TenantId, locationId: string, name: string) {
  const personId = randomUUID();
  const memberId = randomUUID();
  await admin.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, $3, '2015-04-04')",
    [personId, tenant, name],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on)
     values ($1, $2, $3, $4, $5, 'active', '2026-01-01')`,
    [memberId, tenant, personId, locationId, `OIH-${memberId.slice(0, 8)}`],
  );
  return memberId;
}

async function insertBatch(tenant: TenantId, locationId: string, name: string) {
  const programId = randomUUID();
  const batchId = randomUUID();
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Swim')", [
    programId,
    tenant,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, location_id, name, capacity, start_time, end_time)
     values ($1, $2, $3, $4, $5, 20, '07:00', '08:00')`,
    [batchId, tenant, programId, locationId, name],
  );
  return batchId;
}

async function insertEnrolment(tenant: TenantId, batchId: string, memberId: string) {
  await admin.query(
    "insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on) values ($1, $2, $3, $4, '2026-01-01')",
    [randomUUID(), tenant, memberId, batchId],
  );
}

async function insertSession(
  tenant: TenantId,
  batchId: string,
  locationId: string,
  date: string,
) {
  const id = randomUUID();
  await admin.query(
    `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status)
     values ($1, $2, $3, $4, $5, $5::date + time '07:00', $5::date + time '08:00', 'held')`,
    [id, tenant, batchId, locationId, date],
  );
  return id;
}

async function insertMark(
  tenant: TenantId,
  sessionId: string,
  memberId: string,
  locationId: string,
) {
  await admin.query(
    `insert into attendance (id, tenant_id, session_id, member_id, location_id, status, client_id)
     values ($1, $2, $3, $4, $5, 'present', $6)`,
    [randomUUID(), tenant, sessionId, memberId, locationId, randomUUID()],
  );
}

async function insertEnquiry(
  tenant: TenantId,
  locationId: string,
  name: string,
  stage: string,
  createdAtIso: string,
) {
  await admin.query(
    `insert into enquiries (id, tenant_id, full_name, source, stage, location_id, created_at)
     values ($1, $2, $3, 'walk-in', $4, $5, $6)`,
    [randomUUID(), tenant, name, stage, locationId, createdAtIso],
  );
}

// The window the section uses: the last 30 days ending today.
const today = todayInZone(TZ);
const WINDOW = { from: addDays(today, -29), to: addDays(today, 1) };

beforeAll(async () => {
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  admin = db.admin;
  process.env.DATABASE_URL = db.appUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  const insights = await import("@/lib/services/owner-insights");
  getAttendanceByBatch = insights.getAttendanceByBatch;
  getEnquiryStageBreakdown = insights.getEnquiryStageBreakdown;

  tenantId = asTenantId(randomUUID());
  owner.tenantId = tenantId;
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Insights Home', $3, 'active')",
    [tenantId, `insights-home-${RUN}`, TZ],
  );
  await admin.query(
    "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, 'reports', true)",
    [tenantId],
  );

  poolLocationId = await insertLocation(tenantId, "Splash Pool", true);
  marinaLocationId = await insertLocation(tenantId, "Marina Pool", false);

  const poolMember = await insertMember(tenantId, poolLocationId, "Pool Swimmer");
  const marinaMember = await insertMember(tenantId, marinaLocationId, "Marina Swimmer");

  const poolBatch = await insertBatch(tenantId, poolLocationId, "Alpha Squad");
  const marinaBatch = await insertBatch(tenantId, marinaLocationId, "Beta Squad");
  await insertEnrolment(tenantId, poolBatch, poolMember);
  await insertEnrolment(tenantId, marinaBatch, marinaMember);

  const poolSession = await insertSession(tenantId, poolBatch, poolLocationId, today);
  const marinaSession = await insertSession(tenantId, marinaBatch, marinaLocationId, today);
  await insertMark(tenantId, poolSession, poolMember, poolLocationId);
  await insertMark(tenantId, marinaSession, marinaMember, marinaLocationId);

  await insertEnquiry(tenantId, poolLocationId, "Pool Enquiry", "new", `${today}T04:30:00Z`);
  await insertEnquiry(
    tenantId,
    marinaLocationId,
    "Marina Enquiry",
    "converted",
    `${today}T04:30:00Z`,
  );
}, 180_000);

afterAll(async () => {
  cleanup();
  const { pool } = await import("@/db/client");
  await pool.end();
  await db.stop();
}, 180_000);

const BRANDING = {
  displayName: "Splash Sports Club",
  shortName: "SSC",
  accent: "marine",
  fallbackDisplayName: "Splash Sports Club",
  fallbackShortName: "SSC",
  initials: "SS",
} as BrandingData;

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const DASHBOARD = {
  tenantName: "Splash Sports Club",
  scopeLocationName: "Splash Pool",
  today,
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 2,
  attendanceThisWeekPct: null,
  activeBatchCount: 2,
  needsAttention: [],
  todaysLanes: [],
  nextClass: null,
  facilityBreakdown: [],
  money: {
    collectedTodayPaise: 0,
    collectedTodayCount: 0,
    outstandingPaise: 0,
    dueInvoiceCount: 0,
    overduePaise: 0,
    overdueInvoiceCount: 0,
    oldestOverdueDays: null,
  },
} as OwnerDashboardData;

describe("owner Home — the insights section under a facility filter", () => {
  it("reads both sites when the caller is not narrowed", async () => {
    const attendance = await getAttendanceByBatch(owner, WINDOW);
    const enquiries = await getEnquiryStageBreakdown(owner, WINDOW);

    expect(attendance.rows.map((row) => row.batchName).sort()).toEqual([
      "Alpha Squad",
      "Beta Squad",
    ]);
    expect(enquiries.total).toBe(2);
  });

  it("shows only the selected facility's batches and enquiries", async () => {
    const attendance = await getAttendanceByBatch(owner, {
      ...WINDOW,
      locationId: poolLocationId,
    });
    const enquiries = await getEnquiryStageBreakdown(owner, {
      ...WINDOW,
      locationId: poolLocationId,
    });

    // The read is narrow.
    expect(attendance.rows.map((row) => row.batchName)).toEqual(["Alpha Squad"]);
    expect(enquiries.total).toBe(1);

    render(
      <OwnerDashboard
        data={DASHBOARD}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={{
          addMember: true,
          recordPayment: true,
          captureEnquiry: true,
          readFees: true,
          viewSchedule: true,
          readEnquiries: true,
        }}
        insights={{ ...WINDOW, attendance, enquiries }}
        facility={poolLocationId}
      />,
    );

    const text = document.body.textContent ?? "";
    // The selected site's batch is on screen…
    expect(text).toContain("Alpha Squad");
    // …and the other site's batch is not.
    expect(text).not.toContain("Beta Squad");
    // The other site's enquiry is not counted either: one created, and
    // it is the "new" one, not the converted one.
    expect(text).toMatch(/1 created/i);
    expect(text).not.toMatch(/2 created/i);
  });
});
