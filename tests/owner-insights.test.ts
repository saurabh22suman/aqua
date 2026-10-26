// @vitest-environment node
//
// Owner insights — the two selected read models.
//
//   chart-gallery02  Attendance by batch
//   chart-gallery05  Enquiries by current stage
//
// The two rules these charts must never break:
//
//   1. Attendance composition is a share of the MARKS THAT WERE
//      RECORDED. A roster member with no mark is unknown, never
//      absent. Register completion is a SEPARATE measurement against
//      the effective historical roster (enrolled on or before the
//      session date).
//   2. Enquiry counts are the CURRENT stage of a COHORT, counted once
//      per enquiry. They are not a historical step conversion.
//
// Everything here runs against a THROWAWAY Postgres 16 container with
// the real migrations and the real platform catalogue
// (tests/helpers/isolated-db), through the app pool (app_login, tenant
// RLS), so the scoping predicates are exercised as they ship. The other
// tenant in this file exists to prove the isolation: its batches, marks
// and enquiries must never appear in the first tenant's numbers.
//
// The container, not the shared disposable database, because the
// fixtures need the privileged role to create a tenant AND because the
// protected tier1 scan (tests/tier1/no-superuser-on-request-path)
// allows a privileged connection only for files it lists by name — a
// new test file cannot be added to that human-owned allowlist, so this
// file references no privileged URL at all.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";
import type { ActionCtx } from "@/lib/auth/context";
import type {
  AttendanceByBatchInsight,
  EnquiryStageInsight,
} from "@/lib/services/owner-insights";

let db: IsolatedDb;
let admin: Pool;

// ForbiddenError is re-imported AFTER the module reset below, so the
// class identity matches the one the service throws.
let ForbiddenErrorRef: typeof import("@/lib/auth/permission").ForbiddenError;

// The service reads the app pool, which is built from DATABASE_URL at
// import time — so the URL must be in place before the module graph
// loads, and the module is imported ONCE (a reset would orphan the
// pool that holds the connection).
type AttendanceFn = (ctx: ActionCtx, raw: unknown) => Promise<AttendanceByBatchInsight>;
type EnquiryFn = (ctx: ActionCtx, raw: unknown) => Promise<EnquiryStageInsight>;
type AggregateFn = (
  ctx: ActionCtx,
  window: { fromUtc: Date; toUtc: Date },
  options?: { locationId?: string },
) => Promise<{ total: number; byStage: { stage: string; count: number }[] }>;
let getAttendanceByBatch: AttendanceFn;
let getEnquiryStageBreakdown: EnquiryFn;
// The scoped enquiry aggregate, imported AFTER the module reset — a
// static import would bind the pre-reset module instance, whose pool
// points at the ambient database rather than the container.
let countEnquiriesByCurrentStage: AggregateFn;

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

// The window every assertion uses: 2026-06-01 .. 2026-07-01 (June),
// read as tenant-local (IST) calendar days.
const PERIOD = { from: "2026-06-01", to: "2026-07-01" };

let tenantId: TenantId = asTenantId("");
let otherTenantId: TenantId = asTenantId("");
let noFeatureTenantId: TenantId = asTenantId("");
let sharedTenantId: TenantId = asTenantId("");
let locationA = "";
let locationB = "";
let sharedLocation = "";
let memberA = "";
let memberB = "";
let otherMember = "";

// An owner: every location, operational reports allowed.
const owner = {
  userId: asUserId(randomUUID()),
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["reports.operational", "enquiries.read", "settings.manage"]),
};

// A location-scoped staff member: only location A.
const scopedToA = {
  userId: asUserId(randomUUID()),
  roleKey: "admin",
  allLocations: false,
  locationIds: [] as string[],
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

async function insertMember(
  tenant: TenantId,
  locationId: string,
  name: string,
  status = "active",
): Promise<string> {
  const personId = randomUUID();
  const memberId = randomUUID();
  await admin.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, $3, '2015-04-04')",
    [personId, tenant, name],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on)
     values ($1, $2, $3, $4, $5, $6, '2026-01-01')`,
    [memberId, tenant, personId, locationId, `OI-${memberId.slice(0, 8)}`, status],
  );
  return memberId;
}

async function insertBatch(
  tenant: TenantId,
  locationId: string,
  name: string,
): Promise<string> {
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

async function insertEnrolment(
  tenant: TenantId,
  batchId: string,
  memberId: string,
  enrolledOn: string,
) {
  await admin.query(
    "insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on) values ($1, $2, $3, $4, $5)",
    [randomUUID(), tenant, memberId, batchId, enrolledOn],
  );
}

async function insertSession(
  tenant: TenantId,
  batchId: string,
  locationId: string,
  date: string,
  status = "held",
): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status)
     values ($1, $2, $3, $4, $5, $5::date + time '07:00', $5::date + time '08:00', $6)`,
    [id, tenant, batchId, locationId, date, status],
  );
  return id;
}

async function insertMark(
  tenant: TenantId,
  sessionId: string,
  memberId: string,
  locationId: string,
  status: "present" | "late" | "absent",
) {
  await admin.query(
    `insert into attendance (id, tenant_id, session_id, member_id, location_id, status, client_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), tenant, sessionId, memberId, locationId, status, randomUUID()],
  );
}

async function insertEnquiry(
  tenant: TenantId,
  locationId: string | null,
  name: string,
  stage: string,
  createdAtIso: string,
  deleted = false,
) {
  await admin.query(
    `insert into enquiries (id, tenant_id, full_name, source, stage, location_id, created_at, deleted_at)
     values ($1, $2, $3, 'walk-in', $4, $5, $6, $7)`,
    [
      randomUUID(),
      tenant,
      name,
      stage,
      locationId,
      createdAtIso,
      deleted ? new Date().toISOString() : null,
    ],
  );
}

beforeAll(async () => {
  // lib/env.ts parses process.env ONCE, and db/client.ts builds its
  // pool from that parsed DATABASE_URL — the container's URL is only
  // known after it starts, so the module graph has to be reset once
  // the URL is in place. Otherwise the app pool stays pointed at
  // whatever the ambient environment said and every tenant-scoped
  // read returns ZERO ROWS (the contract in db/CLAUDE.md) instead of
  // failing loudly.
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  admin = db.admin;
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(db.adminUri);
  process.env.DATABASE_URL = db.appUri;
  // The isolated database's app_login password (lib/env.ts refuses to
  // boot when APP_LOGIN_PASSWORD and the URL disagree).
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  const insights = await import("@/lib/services/owner-insights");
  getAttendanceByBatch = insights.getAttendanceByBatch;
  getEnquiryStageBreakdown = insights.getEnquiryStageBreakdown;
  const enquiriesModule = await import("@/lib/services/enquiries");
  countEnquiriesByCurrentStage = enquiriesModule.countEnquiriesByCurrentStage as AggregateFn;
  const permissionModule = await import("@/lib/auth/permission");
  ForbiddenErrorRef = permissionModule.ForbiddenError;

  tenantId = asTenantId(randomUUID());
  otherTenantId = asTenantId(randomUUID());
  noFeatureTenantId = asTenantId(randomUUID());
  sharedTenantId = asTenantId(randomUUID());

  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Insights', $3, 'active')",
    [tenantId, `insights-${RUN}`, TZ],
  );
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Other Club', $3, 'active')",
    [otherTenantId, `insights-other-${RUN}`, TZ],
  );
  // A third tenant with NO reports entitlement: the operator's Reports
  // switch is off there.
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'No Reports', $3, 'active')",
    [noFeatureTenantId, `insights-nofeature-${RUN}`, TZ],
  );
  // A fourth tenant for the visibility review: it carries a TENANT-WIDE
  // batch (no location) and an UNRESOLVED enquiry (no location), the
  // two cases where a count could reach a caller who should not see
  // it.
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Shared Scope', $3, 'active')",
    [sharedTenantId, `insights-shared-${RUN}`, TZ],
  );

  locationA = await insertLocation(tenantId, "Insights A", true);
  locationB = await insertLocation(tenantId, "Insights B", false);
  const otherLocation = await insertLocation(otherTenantId, "Other Site", true);

  const memberA1 = await insertMember(tenantId, locationA, "Alpha One");
  const memberA2 = await insertMember(tenantId, locationA, "Alpha Two");
  const memberA3 = await insertMember(tenantId, locationA, "Alpha Three");
  memberA = memberA1;
  memberB = memberA2;
  const lateJoiner = memberA3;
  const betaMember = await insertMember(tenantId, locationB, "Beta One");
  const gammaMember = await insertMember(tenantId, locationA, "Gamma One");
  otherMember = await insertMember(otherTenantId, otherLocation, "Other Swimmer");

  const alphaBatch = await insertBatch(tenantId, locationA, "Alpha Squad");
  const betaBatch = await insertBatch(tenantId, locationB, "Beta Squad");
  const gammaBatch = await insertBatch(tenantId, locationA, "Gamma Squad");
  const otherBatch = await insertBatch(otherTenantId, otherLocation, "Other Squad");

  // Effective historical roster: the late joiner only joins mid-June.
  await insertEnrolment(tenantId, alphaBatch, memberA1, "2026-01-01");
  await insertEnrolment(tenantId, alphaBatch, memberA2, "2026-01-01");
  await insertEnrolment(tenantId, alphaBatch, lateJoiner, "2026-06-20");
  await insertEnrolment(tenantId, betaBatch, betaMember, "2026-01-01");
  await insertEnrolment(tenantId, gammaBatch, gammaMember, "2026-01-01");
  await insertEnrolment(otherTenantId, otherBatch, otherMember, "2026-01-01");

  // Alpha: two marked sessions and one that nobody marked.
  const alphaOne = await insertSession(tenantId, alphaBatch, locationA, "2026-06-10");
  const alphaTwo = await insertSession(tenantId, alphaBatch, locationA, "2026-06-17");
  await insertSession(tenantId, alphaBatch, locationA, "2026-06-24");
  // Outside the window, and cancelled inside it — neither may count.
  const alphaBefore = await insertSession(tenantId, alphaBatch, locationA, "2026-05-20");
  const alphaCancelled = await insertSession(tenantId, alphaBatch, locationA, "2026-06-30", "cancelled");

  await insertMark(tenantId, alphaOne, memberA1, locationA, "present");
  await insertMark(tenantId, alphaOne, memberA2, locationA, "late");
  await insertMark(tenantId, alphaTwo, memberA1, locationA, "present");
  await insertMark(tenantId, alphaTwo, memberA2, locationA, "absent");
  await insertMark(tenantId, alphaBefore, memberA1, locationA, "present");
  await insertMark(tenantId, alphaCancelled, memberA1, locationA, "present");

  // Beta: one session, one mark, at the other location.
  const betaSession = await insertSession(tenantId, betaBatch, locationB, "2026-06-11");
  await insertMark(tenantId, betaSession, betaMember, locationB, "present");

  // Gamma: a session with a roster that nobody marked at all, one
  // session on the FIRST day of the window (included) and one on the
  // day AFTER the window (excluded — `to` is exclusive).
  await insertSession(tenantId, gammaBatch, locationA, "2026-06-01");
  await insertSession(tenantId, gammaBatch, locationA, "2026-06-15");
  await insertSession(tenantId, gammaBatch, locationA, "2026-07-01");

  // The other club: same shapes, different tenant.
  const otherSession = await insertSession(otherTenantId, otherBatch, otherLocation, "2026-06-12");
  await insertMark(otherTenantId, otherSession, otherMember, otherLocation, "present");

  // Enquiries. The window is IST, so 2026-05-31T20:00Z is still
  // 2026-06-01 in the club's day, and 2026-06-30T20:00Z is already
  // 2026-07-01 — one inside, one outside, on the UTC date that a
  // UTC-day implementation would get wrong.
  await insertEnquiry(tenantId, locationA, "Enquiry New", "new", "2026-06-05T04:30:00Z");
  await insertEnquiry(tenantId, locationA, "Enquiry Converted", "converted", "2026-06-06T04:30:00Z");
  await insertEnquiry(tenantId, locationA, "Enquiry Converted Two", "converted", "2026-06-08T04:30:00Z");
  await insertEnquiry(tenantId, locationB, "Enquiry Lost", "lost", "2026-06-07T04:30:00Z");
  await insertEnquiry(tenantId, locationA, "Enquiry First Hour", "contacted", "2026-05-31T20:00:00Z");
  await insertEnquiry(tenantId, locationA, "Enquiry Too Late", "new", "2026-06-30T20:00:00Z");
  await insertEnquiry(tenantId, locationA, "Enquiry Last Month", "new", "2026-05-01T04:30:00Z");
  await insertEnquiry(tenantId, locationA, "Enquiry Removed", "new", "2026-06-09T04:30:00Z", true);
  await insertEnquiry(otherTenantId, otherLocation, "Other Enquiry", "new", "2026-06-05T04:30:00Z");

  // Location-scoped staff: only the explicit list is visible.
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), sharedTenantId],
  );
  scopedToA.locationIds = [locationA];

  // The reports module must be enabled for the tenant, or the read
  // models are switched off with the tenant's Reports setting. The
  // write goes through the container's superuser: the app pool runs
  // as app_user, and the tenant_features foreign key cannot see the
  // tenant row from that role.
  for (const tenant of [tenantId, otherTenantId, sharedTenantId]) {
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, 'reports', true)",
      [tenant],
    );
  }

  // ── The visibility-review fixture ────────────────────────────────────
  // One location, one TENANT-WIDE batch (no location: the house rule
  // says a batch without a facility belongs to the whole business),
  // and one UNRESOLVED enquiry (no location: the management review
  // queue). Both are the shapes where a count could leak to a caller
  // who must not see it.
  sharedLocation = await insertLocation(sharedTenantId, "Shared Site", true);
  const sharedMember = await insertMember(sharedTenantId, sharedLocation, "Shared Swimmer");
  const sharedProgramId = randomUUID();
  const sharedBatchId = randomUUID();
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Swim')", [
    sharedProgramId,
    sharedTenantId,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, location_id, name, capacity, start_time, end_time)
     values ($1, $2, $3, null, 'Tenant Wide Squad', 20, '07:00', '08:00')`,
    [sharedBatchId, sharedTenantId, sharedProgramId],
  );
  await insertEnrolment(sharedTenantId, sharedBatchId, sharedMember, "2026-01-01");
  const sharedSession = await insertSession(sharedTenantId, sharedBatchId, sharedLocation, "2026-06-05");
  await insertMark(sharedTenantId, sharedSession, sharedMember, sharedLocation, "present");
  // The unresolved enquiry: no location, so it belongs to the
  // management review queue rather than to any facility.
  await insertEnquiry(sharedTenantId, null, "Unresolved Enquiry", "new", "2026-06-05T04:30:00Z");
  await insertEnquiry(sharedTenantId, sharedLocation, "Located Enquiry", "contacted", "2026-06-06T04:30:00Z");
}, 180_000);

afterAll(async () => {
  // The app pool holds a connection to the container; close it before
  // the container goes, or the driver reports the teardown as an
  // unhandled error and the shard exits non-zero.
  const { pool } = await import("@/db/client");
  await pool.end();
  await db.stop();
}, 180_000);

describe("attendance by batch — composition of the marks, and register completion", () => {
  it("splits the recorded marks into present, late and absent shares", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    const alpha = insight.rows.find((row) => row.batchName === "Alpha Squad");

    expect(alpha).toBeDefined();
    expect(alpha!.marks).toEqual({ present: 2, late: 1, absent: 1, total: 4 });
    expect(alpha!.shares).toEqual({ present: 50, late: 25, absent: 25 });
    expect(alpha!.sessions).toBe(3);
  });

  it("keeps register completion separate, against the effective historical roster", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    const alpha = insight.rows.find((row) => row.batchName === "Alpha Squad");

    // Three sessions had a roster; two of them were fully marked.
    // The third was not marked at all — its roster members are
    // UNKNOWN, not absent.
    expect(alpha!.register.sessionsWithRoster).toBe(3);
    expect(alpha!.register.completedRegisters).toBe(2);
    expect(alpha!.register.completionPct).toBe(67);
    // The late joiner (enrolled 2026-06-20) is on the roster of the
    // June 24 session only: 2 + 2 + 3 slots.
    expect(alpha!.register.rosterSlots).toBe(7);
    expect(alpha!.register.markedSlots).toBe(4);
    expect(alpha!.register.unmarkedSlots).toBe(3);
  });

  it("never counts an unmarked roster member as absent", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    const gamma = insight.rows.find((row) => row.batchName === "Gamma Squad");
    const alpha = insight.rows.find((row) => row.batchName === "Alpha Squad");

    // Gamma's sessions had a roster and no marks: the shares are
    // unknown (null), not zero, and the absent count stays zero.
    expect(gamma!.marks).toEqual({ present: 0, late: 0, absent: 0, total: 0 });
    expect(gamma!.shares).toEqual({ present: null, late: null, absent: null });
    expect(gamma!.register.sessionsWithRoster).toBe(2);
    expect(gamma!.register.completedRegisters).toBe(0);
    expect(gamma!.register.unmarkedSlots).toBe(2);
    // Alpha's unmarked roster members never became "absent" marks.
    expect(alpha!.marks.absent).toBe(1);
    expect(alpha!.register.unmarkedSlots).toBe(3);
  });

  it("reads the window edges as from-inclusive and to-exclusive", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    const gamma = insight.rows.find((row) => row.batchName === "Gamma Squad");

    // Gamma has three sessions: 2026-06-01 (the first day, INCLUDED),
    // 2026-06-15 and 2026-07-01 (the day AFTER the window, EXCLUDED).
    expect(gamma!.sessions).toBe(2);
    expect(gamma!.register.sessionsWithRoster).toBe(2);
  });

  it("counts only sessions inside the window, and never a cancelled one", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    const alpha = insight.rows.find((row) => row.batchName === "Alpha Squad");

    // May 20 (outside) and June 30 (cancelled) are both excluded, so
    // the marks stay at four and the sessions at three.
    expect(alpha!.sessions).toBe(3);
    expect(alpha!.marks.total).toBe(4);
  });

  it("reconciles the batch rows with the tenant summary", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);

    const summed = insight.rows.reduce(
      (sum, row) => sum + row.marks.total,
      0,
    );
    expect(summed).toBe(insight.summary.marks.total);
    expect(insight.summary.sessions).toBe(6);
    expect(insight.summary.marks).toEqual({ present: 3, late: 1, absent: 1, total: 5 });
    expect(insight.summary.shares).toEqual({ present: 60, late: 20, absent: 20 });
    expect(insight.summary.register.sessionsWithRoster).toBe(6);
    expect(insight.summary.register.completedRegisters).toBe(3);
    expect(insight.summary.register.completionPct).toBe(50);
    expect(insight.summary.register.unmarkedSlots).toBe(5);
  });

  it("keeps the other tenant's batches and marks out of the numbers", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    expect(insight.rows.map((row) => row.batchName)).toEqual([
      "Alpha Squad",
      "Beta Squad",
      "Gamma Squad",
    ]);
    expect(JSON.stringify(insight)).not.toContain(otherMember);
  });

  it("narrows to the caller's locations and cannot be widened by the URL", async () => {
    const scoped = await getAttendanceByBatch({ tenantId, ...scopedToA }, PERIOD);
    expect(scoped.rows.map((row) => row.batchName)).toEqual(["Alpha Squad", "Gamma Squad"]);
    expect(scoped.summary.marks.total).toBe(4);
    expect(scoped.summary.sessions).toBe(5);

    // Asking for the other facility returns nothing, never its marks.
    const widened = await getAttendanceByBatch(
      { tenantId, ...scopedToA },
      { ...PERIOD, locationId: locationB },
    );
    expect(widened.rows).toEqual([]);
    expect(widened.summary.marks.total).toBe(0);
  });

  it("exposes no per-child identity in the read model", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    const serialized = JSON.stringify(insight);

    expect(insight.rows.length).toBe(3);
    expect(serialized).not.toContain(memberA);
    expect(serialized).not.toContain(memberB);
    expect(serialized).not.toContain("memberId");
    expect(serialized).not.toContain("Alpha One");
  });
});

describe("owner insights — input validation", () => {
  it("refuses a period that is not a pair of calendar days", async () => {
    await expect(
      getAttendanceByBatch({ tenantId, ...owner }, { from: "2026-06-01" }),
    ).rejects.toThrow();
    await expect(
      getAttendanceByBatch({ tenantId, ...owner }, { from: "01-06-2026", to: "2026-07-01" }),
    ).rejects.toThrow();
    await expect(
      getEnquiryStageBreakdown({ tenantId, ...owner }, "not-an-object"),
    ).rejects.toThrow();
  });

  it("refuses a period that ends before it starts", async () => {
    await expect(
      getAttendanceByBatch({ tenantId, ...owner }, { from: "2026-07-01", to: "2026-06-01" }),
    ).rejects.toThrow(/period end must be after/i);
    // An empty window is a caller bug too: from === to is not a day.
    await expect(
      getAttendanceByBatch({ tenantId, ...owner }, { from: "2026-06-01", to: "2026-06-01" }),
    ).rejects.toThrow(/period end must be after/i);
    await expect(
      getEnquiryStageBreakdown({ tenantId, ...owner }, { from: "2026-07-01", to: "2026-06-01" }),
    ).rejects.toThrow(/period end must be after/i);
  });

  it("refuses a location that is not a location id", async () => {
    await expect(
      getAttendanceByBatch({ tenantId, ...owner }, { ...PERIOD, locationId: "location-a" }),
    ).rejects.toThrow();
  });
});

describe("owner insights — authorization", () => {
  it("refuses a caller without the operational reports permission", async () => {
    // A coach reads attendance and their own batches, never the
    // owner's operational reports.
    const coach = {
      userId: asUserId(randomUUID()),
      roleKey: "coach",
      allLocations: true,
      locationIds: [] as string[],
      permissions: new Set(["attendance.read"]),
    };

    await expect(getAttendanceByBatch({ tenantId, ...coach }, PERIOD)).rejects.toThrow(
      ForbiddenErrorRef,
    );
    await expect(getEnquiryStageBreakdown({ tenantId, ...coach }, PERIOD)).rejects.toThrow(
      ForbiddenErrorRef,
    );
  });

  it("refuses a caller whose role carries no reports grant", async () => {
    // Same answer without a resolved permission set: the role
    // template is the fallback, and it does not carry the grant.
    const coach = {
      userId: asUserId(randomUUID()),
      roleKey: "coach",
      allLocations: true,
      locationIds: [] as string[],
    };

    await expect(getAttendanceByBatch({ tenantId, ...coach }, PERIOD)).rejects.toThrow(
      ForbiddenErrorRef,
    );
  });

  it("refuses an identity-free caller", async () => {
    // No session, no role, no permissions: the read models are not
    // an anonymous endpoint.
    await expect(getAttendanceByBatch({ tenantId }, PERIOD)).rejects.toThrow(ForbiddenErrorRef);
    await expect(getEnquiryStageBreakdown({ tenantId }, PERIOD)).rejects.toThrow(
      ForbiddenErrorRef,
    );
  });

  it("refuses a permission set without an identity", async () => {
    // "The context says the permission is present" is a statement,
    // not a person: without a user and without a role claim there is
    // nobody to hold the grant.
    const ctx = {
      tenantId,
      permissions: new Set(["reports.operational"]),
    };

    await expect(getAttendanceByBatch(ctx, PERIOD)).rejects.toThrow(ForbiddenErrorRef);
    await expect(getEnquiryStageBreakdown(ctx, PERIOD)).rejects.toThrow(ForbiddenErrorRef);
  });

  it("refuses a tenant whose reports module is switched off", async () => {
    // The operator's Reports switch is a real control. This tenant
    // has no reports entitlement, so even a full owner gets nothing.
    const ownerOfOtherClub = {
      userId: asUserId(randomUUID()),
      roleKey: "owner",
      allLocations: true,
      locationIds: [] as string[],
      permissions: new Set(["reports.operational"]),
    };

    await expect(
      getAttendanceByBatch({ tenantId: noFeatureTenantId, ...ownerOfOtherClub }, PERIOD),
    ).rejects.toThrow(ForbiddenErrorRef);
    await expect(
      getEnquiryStageBreakdown({ tenantId: noFeatureTenantId, ...ownerOfOtherClub }, PERIOD),
    ).rejects.toThrow(ForbiddenErrorRef);
  });

  it("still serves an owner whose role carries the grant", async () => {
    // The guard is permission-based, not role-name-based.
    const templateOwner = {
      userId: asUserId(randomUUID()),
      roleKey: "owner",
      allLocations: true,
      locationIds: [] as string[],
    };

    const insight = await getAttendanceByBatch({ tenantId, ...templateOwner }, PERIOD);
    expect(insight.rows.length).toBe(3);
  });
});

describe("owner insights — the window is a real calendar window", () => {
  it("refuses a date the calendar does not have, before any query runs", async () => {
    // The service parses its own input (defence in depth: the action
    // parses too). A day that never happened must not reach the
    // database, where it would query an empty range and report "no
    // attendance" as if it were a fact about the club.
    await expect(
      getAttendanceByBatch({ tenantId, ...owner }, { from: "2026-02-30", to: "2026-07-01" }),
    ).rejects.toThrow(/YYYY-MM-DD/i);
    await expect(
      getEnquiryStageBreakdown({ tenantId, ...owner }, { from: "2026-06-01", to: "2026-04-31" }),
    ).rejects.toThrow(/YYYY-MM-DD/i);
  });

  it("accepts a real leap day", async () => {
    const insight = await getAttendanceByBatch(
      { tenantId, ...owner },
      { from: "2024-02-29", to: "2024-03-01" },
    );
    // June 2026 data is outside this window, so the chart is empty —
    // but the window itself is valid and the read ran.
    expect(insight.rows).toEqual([]);
    expect(insight.summary.marks.total).toBe(0);
  });
});

describe("visibility review — the counts that could reach the wrong caller", () => {
  // A management caller: it holds settings.manage, so the unresolved
  // (location-less) enquiry queue is its to see.
  const sharedOwner = () => ({
    userId: asUserId(randomUUID()),
    roleKey: "owner",
    allLocations: true,
    locationIds: [] as string[],
    permissions: new Set(["reports.operational", "settings.manage"]),
  });

  // A location-scoped caller WITHOUT settings.manage (an accountant
  // shape): the unresolved queue is NOT its to see, and its location
  // scope applies. Built per call — the tests in this file run in
  // parallel, so a shared mutable ctx would be a race.
  const sharedScoped = () => ({
    userId: asUserId(randomUUID()),
    roleKey: "accountant",
    allLocations: false,
    locationIds: [sharedLocation],
    permissions: new Set(["reports.operational"]),
  });

  it("shows a tenant-wide batch to a location-scoped caller (house rule)", async () => {
    // A batch with no facility belongs to the WHOLE business, so its
    // counts are visible to every caller of the tenant. This is the
    // repository's established rule (lib/services/location-access.ts),
    // pinned here so the chart cannot drift away from it silently.
    const insight = await getAttendanceByBatch(
      { tenantId: sharedTenantId, ...sharedScoped() },
      PERIOD,
    );
    const batch = insight.rows.find((row) => row.batchName === "Tenant Wide Squad");

    expect(batch).toBeDefined();
    expect(batch!.marks.total).toBe(1);
  });

  it("counts the unresolved enquiry for management, not for a non-management caller", async () => {
    // The unresolved queue is a management review path (lib/services/
    // enquiries.ts). The chart must inherit that rule exactly, or it
    // would report a different cohort than the Enquiries page.
    const management = await getEnquiryStageBreakdown(
      { tenantId: sharedTenantId, ...sharedOwner() },
      PERIOD,
    );
    const nonManagement = await getEnquiryStageBreakdown(
      { tenantId: sharedTenantId, ...sharedScoped() },
      PERIOD,
    );

    expect(management.total).toBe(2);
    expect(nonManagement.total).toBe(1);
  });

  it("never lets one tenant's counts reach another tenant's chart", async () => {
    const insight = await getAttendanceByBatch({ tenantId, ...owner }, PERIOD);
    const stages = await getEnquiryStageBreakdown({ tenantId, ...owner }, PERIOD);

    expect(JSON.stringify(insight)).not.toContain("Tenant Wide Squad");
    expect(JSON.stringify(stages)).not.toContain("Unresolved Enquiry");
  });
});

describe("scoped enquiry stage aggregate — the SQL behind the chart", () => {
  // The same window the chart uses, resolved in the tenant's timezone
  // (IST): 2026-06-01 00:00 IST = 2026-05-31 18:30 UTC, and
  // 2026-07-01 00:00 IST = 2026-06-30 18:30 UTC.
  const WINDOW = {
    fromUtc: new Date("2026-05-31T18:30:00.000Z"),
    toUtc: new Date("2026-06-30T18:30:00.000Z"),
  };

  it("counts the current stage of every enquiry in the cohort, once each", async () => {
    const counts = await countEnquiriesByCurrentStage({ tenantId, ...owner }, WINDOW);
    const byStage = Object.fromEntries(counts.byStage.map((row) => [row.stage, row.count]));

    expect(counts.total).toBe(5);
    expect(byStage).toEqual({ new: 1, contacted: 1, converted: 2, lost: 1 });
    // Each enquiry is counted once: the stage counts sum to the cohort.
    expect(counts.byStage.reduce((sum, row) => sum + row.count, 0)).toBe(counts.total);
  });

  it("keeps another tenant's enquiries out of the aggregate", async () => {
    const counts = await countEnquiriesByCurrentStage({ tenantId, ...owner }, WINDOW);
    expect(counts.total).toBe(5);
    expect(JSON.stringify(counts)).not.toContain("Other Enquiry");
  });

  it("narrows to the caller's locations", async () => {
    const scoped = await countEnquiriesByCurrentStage({ tenantId, ...scopedToA }, WINDOW);
    const byStage = Object.fromEntries(scoped.byStage.map((row) => [row.stage, row.count]));

    // The lost enquiry belongs to the other facility.
    expect(scoped.total).toBe(4);
    expect(byStage.lost).toBeUndefined();
  });

  it("narrows further by the requested location", async () => {
    const scoped = await countEnquiriesByCurrentStage(
      { tenantId, ...owner },
      WINDOW,
      { locationId: locationB },
    );
    const byStage = Object.fromEntries(scoped.byStage.map((row) => [row.stage, row.count]));

    expect(scoped.total).toBe(1);
    expect(byStage.lost).toBe(1);
  });

  it("counts nothing outside the cohort window", async () => {
    const empty = await countEnquiriesByCurrentStage(
      { tenantId, ...owner },
      { fromUtc: new Date("2026-04-01T00:00:00.000Z"), toUtc: new Date("2026-05-01T00:00:00.000Z") },
    );
    expect(empty.total).toBe(0);
    expect(empty.byStage).toEqual([]);
  });
});

describe("enquiries by current stage — a snapshot of a cohort", () => {
  it("counts every enquiry in the cohort once, at its current stage", async () => {
    const insight = await getEnquiryStageBreakdown({ tenantId, ...owner }, PERIOD);
    const byStage = Object.fromEntries(insight.rows.map((row) => [row.stage, row.count]));

    // Five enquiries were created inside the June window: one new,
    // one contacted, two converted, one lost. Each is counted once —
    // an enquiry that walked through the pipeline contributes to its
    // CURRENT stage only.
    expect(insight.total).toBe(5);
    expect(byStage).toEqual({
      new: 1,
      contacted: 1,
      trial_scheduled: 0,
      trial_completed: 0,
      converted: 2,
      lost: 1,
    });
    const summed = insight.rows.reduce((sum, row) => sum + row.count, 0);
    expect(summed).toBe(insight.total);
    const byShare = Object.fromEntries(insight.rows.map((row) => [row.stage, row.share]));
    expect(byShare).toEqual({
      new: 20,
      contacted: 20,
      trial_scheduled: 0,
      trial_completed: 0,
      converted: 40,
      lost: 20,
    });
  });

  it("reads the cohort window as tenant-local days, not UTC days", async () => {
    const insight = await getEnquiryStageBreakdown({ tenantId, ...owner }, PERIOD);
    const byStage = Object.fromEntries(insight.rows.map((row) => [row.stage, row.count]));

    // Created 2026-05-31T20:00Z = 2026-06-01 01:30 IST → inside.
    // Created 2026-06-30T20:00Z = 2026-07-01 01:30 IST → outside.
    expect(byStage.contacted).toBe(1);
    expect(byStage.new).toBe(1);
  });

  it("reports an empty cohort as unknown shares rather than zero shares", async () => {
    const insight = await getEnquiryStageBreakdown(
      { tenantId, ...owner },
      { from: "2026-04-01", to: "2026-05-01" },
    );
    expect(insight.total).toBe(0);
    expect(insight.rows.every((row) => row.count === 0)).toBe(true);
    expect(insight.rows.every((row) => row.share === null)).toBe(true);
  });

  it("keeps the other tenant's enquiries out of the cohort", async () => {
    const insight = await getEnquiryStageBreakdown({ tenantId, ...owner }, PERIOD);
    expect(insight.total).toBe(5);
    expect(JSON.stringify(insight)).not.toContain("Other Enquiry");
  });

  it("narrows to the caller's locations", async () => {
    const scoped = await getEnquiryStageBreakdown({ tenantId, ...scopedToA }, PERIOD);
    const byStage = Object.fromEntries(scoped.rows.map((row) => [row.stage, row.count]));

    // The lost enquiry belongs to the other facility.
    expect(scoped.total).toBe(4);
    expect(byStage.lost).toBe(0);
    expect(byStage.converted).toBe(2);
  });
});
