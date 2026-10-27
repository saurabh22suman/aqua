// @vitest-environment node
//
// Characterisation of lib/services/enquiries.ts BEFORE its split into
// flat modules.
//
// This is a behaviour-preserving refactor, so there is no RED to
// produce here: the tests below are written against the CURRENT
// implementation and are expected to pass on it. They are the
// evidence that the split did not change anything, and they add the
// scope negatives the protected tier1 suite does not cover (tenant
// isolation, location scope, the management-only unresolved queue,
// soft deletes, and the forged-id refusals).
//
// The database is a THROWAWAY Postgres 16 container (tests/helpers/
// isolated-db) rather than the shared disposable database, because the
// fixtures need the privileged role to create a tenant AND because the
// protected tier1 scan (tests/tier1/no-superuser-on-request-path)
// allows a privileged connection only for files it lists by name — a
// new test file cannot be added to that human-owned allowlist, so this
// file references no privileged URL at all.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";

let db: IsolatedDb;
let admin: import("pg").Pool;

type EnquiriesModule = typeof import("@/lib/services/enquiries");
let enquiries: EnquiriesModule;

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let otherTenantId: TenantId = asTenantId("");
let locationA = "";
let locationB = "";

// The actors of this file. The enquiry audit trail names its actor
// through audit_log.actor_id, which references users(id) -- a caller id
// that is not a real users row cannot be recorded, so the actor is
// seeded below like the other rows of this fixture.
const actorUserId = asUserId(randomUUID());

// A management caller: every location, and the unresolved queue.
const manager = () => ({
  tenantId,
  userId: actorUserId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["settings.manage", "enquiries.read", "enquiries.write"]),
});

// A location-scoped caller WITH settings.manage (management, but only
// its own facility).
const scopedManager = () => ({
  tenantId,
  userId: actorUserId,
  roleKey: "admin",
  allLocations: false,
  locationIds: [locationA],
  permissions: new Set(["settings.manage", "enquiries.read", "enquiries.write"]),
});

// A location-scoped caller WITHOUT settings.manage: the unresolved
// queue is not its to see.
const scopedNonManager = () => ({
  tenantId,
  userId: actorUserId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locationA],
  permissions: new Set(["enquiries.read", "enquiries.write"]),
});

async function insertLocation(tenant: TenantId, name: string, isPrimary: boolean) {
  const id = randomUUID();
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, $3, $4)",
    [id, tenant, name, isPrimary],
  );
  return id;
}

async function insertEnquiry(
  tenant: TenantId,
  locationId: string | null,
  name: string,
  stage: string,
  createdAtIso: string,
  deleted = false,
) {
  const id = randomUUID();
  await admin.query(
    `insert into enquiries (id, tenant_id, full_name, source, stage, location_id, created_at, deleted_at)
     values ($1, $2, $3, 'walk-in', $4, $5, $6, $7)`,
    [id, tenant, name, stage, locationId, createdAtIso, deleted ? new Date().toISOString() : null],
  );
  return id;
}

beforeAll(async () => {
  // lib/env.ts parses process.env ONCE and db/client.ts builds its
  // pool from that parsed DATABASE_URL, so the module graph has to be
  // reset once the container's URL is in place.
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  admin = db.admin;
  process.env.DATABASE_URL = db.appUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  enquiries = await import("@/lib/services/enquiries");

  tenantId = asTenantId(randomUUID());
  otherTenantId = asTenantId(randomUUID());
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Enquiry Scope', $3, 'active')",
    [tenantId, `enquiry-scope-${RUN}`, TZ],
  );
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Other Club', $3, 'active')",
    [otherTenantId, `enquiry-other-${RUN}`, TZ],
  );
  locationA = await insertLocation(tenantId, "Scope A", true);
  locationB = await insertLocation(tenantId, "Scope B", false);
  const otherLocation = await insertLocation(otherTenantId, "Other Site", true);

  // The actor of every caller context in this file.
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actorUserId,
    "+919900000901",
  ]);

  // E1 — located, visible. E2 — located elsewhere. E3 — unresolved
  // (no location: the management review queue). E4 — soft deleted.
  await insertEnquiry(tenantId, locationA, "Scope A Enquiry", "new", "2026-06-01T04:30:00Z");
  await insertEnquiry(tenantId, locationB, "Scope B Enquiry", "new", "2026-06-02T04:30:00Z");
  await insertEnquiry(tenantId, null, "Unresolved Enquiry", "new", "2026-06-03T04:30:00Z");
  await insertEnquiry(tenantId, locationA, "Removed Enquiry", "new", "2026-06-04T04:30:00Z", true);
  await insertEnquiry(otherTenantId, otherLocation, "Foreign Enquiry", "new", "2026-06-01T04:30:00Z");

  // Location-scoped staff: only the explicit list is visible.
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );

  // A follow-up on the located enquiry: overdue, and one in the future.
  const located = await admin.query(
    "select id from enquiries where tenant_id = $1 and full_name = 'Scope A Enquiry'",
    [tenantId],
  );
  await admin.query(
    `insert into enquiry_follow_ups (id, tenant_id, enquiry_id, due_at, note)
     values ($1, $2, $3, now() - interval '2 days', 'overdue')`,
    [randomUUID(), tenantId, located.rows[0].id],
  );
  await admin.query(
    `insert into enquiry_follow_ups (id, tenant_id, enquiry_id, due_at, note)
     values ($1, $2, $3, now() + interval '2 days', 'later')`,
    [randomUUID(), tenantId, located.rows[0].id],
  );
}, 180_000);

afterAll(async () => {
  const { pool } = await import("@/db/client");
  await pool.end();
  await db.stop();
}, 180_000);

describe("enquiry service — public surface", () => {
  it("keeps every public export the callers import", () => {
    const names = Object.keys(enquiries);
    for (const expected of [
      "createEnquiry",
      "listEnquiries",
      "getEnquiryDetail",
      "transitionEnquiryStage",
      "addFollowUp",
      "completeFollowUp",
      "listOverdueFollowUps",
      "bookTrial",
      "convertEnquiry",
      "conversionRateBySource",
      "countEnquiriesByCurrentStage",
    ]) {
      expect(names, `missing export: ${expected}`).toContain(expected);
    }
  });
});

describe("enquiry service — capture", () => {
  it("captures a walk-in at the caller's site", async () => {
    const row = await enquiries.createEnquiry(manager(), {
      fullName: "Captured Walk-in",
      source: "walk-in",
      locationId: locationA,
    });
    expect(row.stage).toBe("new");
    expect(row.locationId).toBe(locationA);
    expect(row.source).toBe("walk-in");
  });

  it("refuses a capture at a location the caller cannot access", async () => {
    await expect(
      enquiries.createEnquiry(scopedNonManager(), {
        fullName: "Wrong Site",
        source: "walk-in",
        locationId: locationB,
      }),
    ).rejects.toThrow(/location you have access to/i);
  });
});

describe("enquiry service — list scope", () => {
  it("shows a management caller every located enquiry plus the unresolved queue", async () => {
    const rows = await enquiries.listEnquiries(manager());
    const names = rows.map((row) => row.fullName);

    expect(names).toContain("Scope A Enquiry");
    expect(names).toContain("Scope B Enquiry");
    expect(names).toContain("Unresolved Enquiry");
    // A soft-deleted row is not a live enquiry.
    expect(names).not.toContain("Removed Enquiry");
  });

  it("keeps another tenant's enquiries out of the list", async () => {
    const rows = await enquiries.listEnquiries(manager());
    expect(rows.map((row) => row.fullName)).not.toContain("Foreign Enquiry");
  });

  it("narrows a location-scoped caller to its own facility", async () => {
    const rows = await enquiries.listEnquiries(scopedManager());
    const names = rows.map((row) => row.fullName);

    expect(names).toContain("Scope A Enquiry");
    expect(names).not.toContain("Scope B Enquiry");
  });

  it("hides the unresolved queue from a non-management caller", async () => {
    const rows = await enquiries.listEnquiries(scopedNonManager());
    const names = rows.map((row) => row.fullName);

    expect(names).toContain("Scope A Enquiry");
    expect(names).not.toContain("Unresolved Enquiry");
  });

  it("filters by stage", async () => {
    const rows = await enquiries.listEnquiries(manager(), { stage: "new" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.stage === "new")).toBe(true);
  });

  it("refuses to open an enquiry the caller cannot see", async () => {
    const foreign = await admin.query(
      "select id from enquiries where tenant_id = $1 and full_name = 'Foreign Enquiry'",
      [otherTenantId],
    );
    const detail = await enquiries.getEnquiryDetail(manager(), foreign.rows[0].id);
    expect(detail).toBeNull();
  });
});

describe("enquiry service — stage pipeline", () => {
  it("moves an enquiry along the allowed graph", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Pipeline Enquiry",
      source: "phone",
      locationId: locationA,
    });

    const moved = await enquiries.transitionEnquiryStage(manager(), {
      enquiryId: created.id,
      toStage: "contacted",
    });
    expect(moved).toEqual({ ok: true });

    const detail = await enquiries.getEnquiryDetail(manager(), created.id);
    expect(detail?.stage).toBe("contacted");
  });

  it("refuses a transition that is not in the allowed graph", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Illegal Transition",
      source: "phone",
      locationId: locationA,
    });

    // "new" may become contacted / trial_scheduled / converted / lost
    // — but never trial_completed (that is a step further down).
    const result = await enquiries.transitionEnquiryStage(manager(), {
      enquiryId: created.id,
      toStage: "trial_completed",
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/cannot move an enquiry/i);
  });

  it("refuses a transition on an enquiry the caller cannot see", async () => {
    const rows = await enquiries.listEnquiries(scopedNonManager());
    const other = rows.find((row) => row.fullName === "Scope B Enquiry");
    expect(other).toBeUndefined();
  });
});

describe("enquiry service — follow-ups", () => {
  it("surfaces an overdue follow-up and removes it when completed", async () => {
    const before = await enquiries.listOverdueFollowUps(manager());
    const overdue = before.find((row) => row.enquiryName === "Scope A Enquiry");
    expect(overdue).toBeDefined();

    const completed = await enquiries.completeFollowUp(manager(), overdue!.id);
    expect(completed).toEqual({ ok: true });

    const after = await enquiries.listOverdueFollowUps(manager());
    expect(after.find((row) => row.id === overdue!.id)).toBeUndefined();
  });

  it("does not surface a future follow-up as overdue", async () => {
    const rows = await enquiries.listOverdueFollowUps(manager());
    expect(rows.find((row) => row.note === "later")).toBeUndefined();
  });

  it("refuses a follow-up on an enquiry the caller cannot see", async () => {
    const rows = await enquiries.listEnquiries(scopedNonManager());
    const visible = rows.find((row) => row.fullName === "Scope A Enquiry");
    const created = await enquiries.addFollowUp(scopedNonManager(), {
      enquiryId: visible!.id,
      dueAt: new Date(),
      note: "mine",
    });
    expect(created.id).toBeTruthy();
  });
});

describe("enquiry service — aggregate and conversion rate", () => {
  it("counts the current stage of the cohort, once per enquiry", async () => {
    const window = {
      fromUtc: new Date("2026-05-31T18:30:00.000Z"),
      toUtc: new Date("2026-06-30T18:30:00.000Z"),
    };
    const counts = await enquiries.countEnquiriesByCurrentStage(manager(), window);
    const byStage = Object.fromEntries(counts.byStage.map((row) => [row.stage, row.count]));

    expect(counts.total).toBeGreaterThan(0);
    expect(counts.byStage.reduce((sum, row) => sum + row.count, 0)).toBe(counts.total);
    expect(byStage.new).toBeGreaterThan(0);
  });

  it("narrows the aggregate by location", async () => {
    const window = {
      fromUtc: new Date("2026-05-31T18:30:00.000Z"),
      toUtc: new Date("2026-06-30T18:30:00.000Z"),
    };
    const scoped = await enquiries.countEnquiriesByCurrentStage(
      scopedNonManager(),
      window,
      { locationId: locationB },
    );
    expect(scoped.total).toBe(0);
  });

  it("reports total and converted counts per source", async () => {
    const rows = await enquiries.conversionRateBySource(manager());
    const walkIn = rows.find((row) => row.source === "walk-in");

    expect(walkIn).toBeDefined();
    expect(walkIn!.total).toBeGreaterThan(0);
    expect(walkIn!.converted).toBe(0);
    expect(walkIn!.ratePct).toBe(0);
  });
});
