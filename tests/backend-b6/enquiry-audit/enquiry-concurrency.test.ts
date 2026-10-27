// @vitest-environment node
//
// Backend batch 6 — concurrency hardening of the enquiry pipeline.
//
// WHAT this proves: a stage transition and a follow-up completion
// decide AND write against ONE state of the row. Two concurrent
// callers must serialise, the audit row must describe the real
// before -> after chain, and a transition the graph forbids must be
// rejected without touching the row or the trail.
//
// WHY a real database and a real lock: "the transition locks the row
// before it reads the stage" is a claim about PostgreSQL row locks
// and MVCC, not about a mock. The tests below drive the production
// path against a real Postgres 16 (the established
// tests/helpers/isolated-db Testcontainer fixture) and force the
// interleaving with a REAL second transaction that holds the row
// lock, so the outcome is deterministic rather than a race we hope
// to hit.
//
// The scope of the lock is part of the contract: a caller that cannot
// SEE an enquiry (another tenant, another location) must not wait on
// — and must not be able to learn about — the row. That is asserted
// directly, not assumed.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { enquiryFollowUps, enquiries } from "@/db/schema/enquiries";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";

let db: IsolatedDb;
let admin: import("pg").Pool;

type EnquiryModule = typeof import("@/lib/services/enquiries");
let enquiriesService: EnquiryModule;
let withTenant: typeof import("@/db/tenant").withTenant;
type TenantTx = Parameters<Parameters<typeof withTenant>[1]>[0];

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: unknown;
  after_state: unknown;
  changed_fields: string[] | null;
};

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let otherTenantId: TenantId = asTenantId("");
let locationA = "";
let locationB = "";

const managerUserId = asUserId(randomUUID());
const receptionUserId = asUserId(randomUUID());

const manager = (userId: UserId = managerUserId) => ({
  tenantId,
  userId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["settings.manage", "enquiries.read", "enquiries.write"]),
});

// A location-scoped caller of location B: it may not see, wait on, or
// learn about an enquiry at location A.
const receptionAtB = (userId: UserId = receptionUserId) => ({
  tenantId,
  userId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locationB],
  permissions: new Set(["enquiries.read", "enquiries.write"]),
});

// A caller of the other tenant.
const foreignManager = (userId: UserId = managerUserId) => ({
  tenantId: otherTenantId,
  userId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["settings.manage", "enquiries.read", "enquiries.write"]),
});

async function insertLocation(tenant: TenantId, name: string, isPrimary: boolean) {
  const id = randomUUID();
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, $3, $4)",
    [id, tenant, name, isPrimary],
  );
  return id;
}

async function auditRows(filter: {
  tenantId?: string;
  entityId?: string;
  action?: string;
}): Promise<AuditRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.tenantId) {
    params.push(filter.tenantId);
    clauses.push(`tenant_id = $${params.length}`);
  }
  if (filter.entityId) {
    params.push(filter.entityId);
    clauses.push(`entity_id = $${params.length}`);
  }
  if (filter.action) {
    params.push(filter.action);
    clauses.push(`action = $${params.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const { rows } = await admin.query<AuditRow>(
    `select id, action, entity_type, entity_id,
            "before" as before_state, "after" as after_state, changed_fields
       from audit_log ${where} order by id`,
    params,
  );
  return rows;
}

// "settled" if the promise resolved (or rejected) before the deadline,
// "waiting" if it was still outstanding.
async function settledWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<"settled" | "waiting"> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<"waiting">((resolve) => {
    timer = setTimeout(() => resolve("waiting"), ms);
  });
  const outcome = await Promise.race([
    promise.then(
      () => "settled" as const,
      () => "settled" as const,
    ),
    timeout,
  ]);
  clearTimeout(timer!);
  return outcome;
}

type Held = {
  /** Lets the holding transaction commit. */
  release: () => void;
  /** Resolves once the holding transaction has committed. */
  finished: Promise<void>;
};

// Holds a transaction open that OWNS the row lock of one enquiry, so
// a concurrent caller can be observed while another transaction holds
// the row. `mutate` runs inside that transaction, before the release,
// so the concurrent caller sees the PRE-change committed state until
// the lock is released.
async function holdEnquiryLock(
  enquiryId: string,
  mutate?: (tx: TenantTx) => Promise<void>,
): Promise<Held> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });

  const finished = withTenant(tenantId, async (tx) => {
    await tx.execute(
      sql`select id from enquiries where id = ${enquiryId} for update`,
    );
    if (mutate) await mutate(tx);
    ready();
    await released;
  });

  await isReady;
  return { release, finished };
}

// The same, for one follow-up row.
async function holdFollowUpLock(
  followUpId: string,
  mutate?: (tx: TenantTx) => Promise<void>,
): Promise<Held> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });

  const finished = withTenant(tenantId, async (tx) => {
    await tx.execute(
      sql`select id from enquiry_follow_ups where id = ${followUpId} for update`,
    );
    if (mutate) await mutate(tx);
    ready();
    await released;
  });

  await isReady;
  return { release, finished };
}

beforeAll(async () => {
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  admin = db.admin;
  process.env.DATABASE_URL = db.appUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  enquiriesService = await import("@/lib/services/enquiries");
  ({ withTenant } = await import("@/db/tenant"));

  tenantId = asTenantId(randomUUID());
  otherTenantId = asTenantId(randomUUID());
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Enquiry Concurrency', $3, 'active')",
    [tenantId, `enquiry-conc-${RUN}`, TZ],
  );
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Other Concurrency Club', $3, 'active')",
    [otherTenantId, `enquiry-conc-other-${RUN}`, TZ],
  );
  locationA = await insertLocation(tenantId, "Concurrency A", true);
  locationB = await insertLocation(tenantId, "Concurrency B", false);

  await admin.query("insert into users (id, phone) values ($1, $2), ($3, $4)", [
    managerUserId,
    "+919900000201",
    receptionUserId,
    "+919900000202",
  ]);

  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );
}, 180_000);

afterAll(async () => {
  const { pool } = await import("@/db/client");
  await pool.end();
  await db.stop();
}, 180_000);

describe("transitionEnquiryStage — concurrency", () => {
  it("rejects a transition the graph forbids once another transaction has moved the enquiry", async () => {
    const created = await enquiriesService.createEnquiry(manager(), {
      fullName: "Concurrency Stale Subject",
      source: "phone",
      locationId: locationA,
    });

    // Another transaction takes the enquiry and converts it. The
    // transition below wants "contacted", which the graph allows from
    // "new" — but not from "converted".
    const held = await holdEnquiryLock(created.id, async (tx) => {
      await tx
        .update(enquiries)
        .set({ stage: "converted" })
        .where(eq(enquiries.id, created.id));
    });

    const pending = enquiriesService.transitionEnquiryStage(manager(), {
      enquiryId: created.id,
      toStage: "contacted",
    });

    // The transition waits for the row instead of deciding on a state
    // it has already read.
    expect(await settledWithin(pending, 250)).toBe("waiting");

    held.release();
    const result = await pending;
    await held.finished;

    expect(result).toEqual({
      ok: false,
      error: "Cannot move an enquiry from converted to contacted.",
    });

    // No mutation ...
    const stored = await admin.query<{ stage: string }>(
      "select stage from enquiries where id = $1",
      [created.id],
    );
    expect(stored.rows[0].stage).toBe("converted");

    // ... and no audit row for the refused transition.
    const rows = await auditRows({
      tenantId,
      entityId: created.id,
      action: "enquiry.stage",
    });
    expect(rows).toHaveLength(0);
  });

  it("lets exactly one of two concurrent transitions to the same stage apply, and audits it once", async () => {
    const created = await enquiriesService.createEnquiry(manager(), {
      fullName: "Concurrency Same Target Subject",
      source: "phone",
      locationId: locationA,
    });

    const [first, second] = await Promise.all([
      enquiriesService.transitionEnquiryStage(manager(), {
        enquiryId: created.id,
        toStage: "contacted",
      }),
      enquiriesService.transitionEnquiryStage(manager(), {
        enquiryId: created.id,
        toStage: "contacted",
      }),
    ]);

    // One applied, one refused: the second saw the stage the first
    // wrote, and "contacted" is not a transition out of "contacted".
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const refused = [first, second].find((r) => !r.ok);
    expect(refused && !refused.ok && refused.error).toMatch(
      /cannot move an enquiry from contacted to contacted/i,
    );

    const rows = await auditRows({
      tenantId,
      entityId: created.id,
      action: "enquiry.stage",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].before_state).toEqual({ stage: "new" });
    expect(rows[0].after_state).toEqual({ stage: "contacted" });

    const stored = await admin.query<{ stage: string }>(
      "select stage from enquiries where id = $1",
      [created.id],
    );
    expect(stored.rows[0].stage).toBe("contacted");
  });

  it("audits a before -> after chain when two concurrent transitions both apply", async () => {
    const created = await enquiriesService.createEnquiry(manager(), {
      fullName: "Concurrency Chain Subject",
      source: "phone",
      locationId: locationA,
    });

    await Promise.all([
      enquiriesService.transitionEnquiryStage(manager(), {
        enquiryId: created.id,
        toStage: "contacted",
      }),
      enquiriesService.transitionEnquiryStage(manager(), {
        enquiryId: created.id,
        toStage: "lost",
      }),
    ]);

    const rows = await auditRows({
      tenantId,
      entityId: created.id,
      action: "enquiry.stage",
    });

    // The chain: each row starts where the previous one ended.
    for (let i = 1; i < rows.length; i++) {
      expect((rows[i].before_state as { stage: string }).stage).toBe(
        (rows[i - 1].after_state as { stage: string }).stage,
      );
    }
    // The first row starts at the stage the enquiry really had.
    expect((rows[0].before_state as { stage: string }).stage).toBe("new");
    // The last row ends at the stage the enquiry is in now.
    const stored = await admin.query<{ stage: string }>(
      "select stage from enquiries where id = $1",
      [created.id],
    );
    const last = rows[rows.length - 1].after_state as { stage: string };
    expect(last.stage).toBe(stored.rows[0].stage);

    // The trail stays free of the enquiry's personal data.
    const payload = JSON.stringify(rows.map((r) => [r.before_state, r.after_state]));
    expect(payload).not.toContain("Concurrency Chain Subject");
  });

  it("does not let a caller outside the location scope wait on — or learn about — the row", async () => {
    const created = await enquiriesService.createEnquiry(manager(), {
      fullName: "Concurrency Scope Subject",
      source: "phone",
      locationId: locationA,
    });

    const held = await holdEnquiryLock(created.id);

    try {
      // A caller scoped to another location cannot see this enquiry, so
      // it must not wait for the row lock it may never touch.
      const outsider = await settledWithin(
        enquiriesService.transitionEnquiryStage(receptionAtB(), {
          enquiryId: created.id,
          toStage: "contacted",
        }),
        2000,
      );
      expect(outsider).toBe("settled");
      expect(
        await enquiriesService.transitionEnquiryStage(receptionAtB(), {
          enquiryId: created.id,
          toStage: "contacted",
        }),
      ).toEqual({ ok: false, error: "Enquiry not found." });

      // A caller of another tenant likewise.
      expect(
        await enquiriesService.transitionEnquiryStage(foreignManager(), {
          enquiryId: created.id,
          toStage: "contacted",
        }),
      ).toEqual({ ok: false, error: "Enquiry not found." });
    } finally {
      held.release();
      await held.finished;
    }

    // The legitimate caller still sees the enquiry untouched.
    const stored = await admin.query<{ stage: string }>(
      "select stage from enquiries where id = $1",
      [created.id],
    );
    expect(stored.rows[0].stage).toBe("new");
    const rows = await auditRows({
      tenantId,
      entityId: created.id,
      action: "enquiry.stage",
    });
    expect(rows).toHaveLength(0);
  });
});

describe("completeFollowUp — concurrency", () => {
  it("does not complete a follow-up again when another transaction already completed it", async () => {
    const created = await enquiriesService.createEnquiry(manager(), {
      fullName: "Concurrency Follow Up Subject",
      source: "phone",
      locationId: locationA,
    });
    const followUp = await enquiriesService.addFollowUp(manager(), {
      enquiryId: created.id,
      dueAt: new Date("2026-11-01T10:00:00.000Z"),
    });

    // Another transaction completes the follow-up while holding its
    // row lock.
    const completedAt = new Date("2026-11-05T09:00:00.000Z");
    const held = await holdFollowUpLock(followUp.id, async (tx) => {
      await tx
        .update(enquiryFollowUps)
        .set({ doneAt: completedAt })
        .where(eq(enquiryFollowUps.id, followUp.id));
    });

    const pending = enquiriesService.completeFollowUp(manager(), followUp.id);
    expect(await settledWithin(pending, 250)).toBe("waiting");

    held.release();
    const result = await pending;
    await held.finished;

    // The caller still sees the follow-up as done ...
    expect(result).toEqual({ ok: true });

    // ... but it is not completed twice, and the completion moment is
    // the one that was recorded.
    const rows = await auditRows({
      tenantId,
      entityId: followUp.id,
      action: "enquiry.follow_up.complete",
    });
    expect(rows).toHaveLength(0);

    const stored = await admin.query<{ done_at: Date }>(
      "select done_at from enquiry_follow_ups where id = $1",
      [followUp.id],
    );
    expect(stored.rows[0].done_at.toISOString()).toBe(completedAt.toISOString());
  });

  it("completes a follow-up exactly once when two callers race", async () => {
    const created = await enquiriesService.createEnquiry(manager(), {
      fullName: "Concurrency Follow Up Race Subject",
      source: "phone",
      locationId: locationA,
    });
    const followUp = await enquiriesService.addFollowUp(manager(), {
      enquiryId: created.id,
      dueAt: new Date("2026-11-01T10:00:00.000Z"),
    });

    const [first, second] = await Promise.all([
      enquiriesService.completeFollowUp(manager(), followUp.id),
      enquiriesService.completeFollowUp(manager(), followUp.id),
    ]);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });

    const rows = await auditRows({
      tenantId,
      entityId: followUp.id,
      action: "enquiry.follow_up.complete",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].before_state).toEqual({ doneAt: null });
    expect((rows[0].after_state as { doneAt: string }).doneAt).toBeTruthy();

    // The stored completion is the one that was recorded, not a second
    // stamp.
    const stored = await admin.query<{ done_at: Date }>(
      "select done_at from enquiry_follow_ups where id = $1",
      [followUp.id],
    );
    expect(stored.rows[0].done_at.toISOString()).toBe(
      (rows[0].after_state as { doneAt: string }).doneAt,
    );
  });
});
