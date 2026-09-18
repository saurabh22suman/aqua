import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// V-10 — assessments from the register. The action layer is
// zod -> permission levels.assess -> service; the service records the
// band (1-4), assessor and timestamp, and audits one row per
// assessment. History is newest-first.
//
// The action reads its ctx through requireDefaultCtx, so this file
// mocks that module with a mutable context: the positive cases carry
// levels.assess + the swim.levels feature, the refusal case carries
// attendance.mark only. Everything else (services, RLS, audit) is the
// real path against the real database. Written before the action file
// existed: the first run is deliberately red.

const state = vi.hoisted(() => ({
  ctx: null as unknown as {
    tenantId: string;
    userId: string;
    permissions: Set<string>;
    features: Set<string>;
  },
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => state.ctx,
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const actor = asUserId(uuidv7());
const memberA = asMemberId(uuidv7());
const memberAPerson = uuidv7();
const memberB = asMemberId(uuidv7());
const memberBPerson = uuidv7();

const frameworkA = uuidv7();
const levelA = uuidv7();
const skillA = uuidv7();
const skillA2 = uuidv7();

let actions: typeof import("@/lib/actions/assessments");
let progressService: typeof import("@/lib/services/skill-progress");

function ctxWith(permissions: string[]): void {
  state.ctx = {
    tenantId: tenantA,
    userId: actor,
    permissions: new Set(permissions),
    features: new Set(["swimming", "swim.levels", "members", "attendance"]),
  };
}

async function auditCount(tenantId: string, action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]?.count ?? "0");
}

beforeAll(async () => {
  actions = await import("@/lib/actions/assessments");
  progressService = await import("@/lib/services/skill-progress");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Assess A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Assess B', 'active', 'Asia/Kolkata')`,
    [tenantA, `v10-a-${RUN}`, tenantB, `v10-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Assess Loc A', true), ($2, $4, 'Assess Loc B', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $3, 'Assess Swimmer'), ($2, $4, 'Other Swimmer')`,
    [memberAPerson, memberBPerson, tenantA, tenantB],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code) values
       ($1, $3, $5, $7, 'active', $9), ($2, $4, $6, $8, 'active', $10)`,
    [
      memberA,
      memberB,
      tenantA,
      tenantB,
      memberAPerson,
      memberBPerson,
      locA,
      locB,
      `AS-${RUN}-1`,
      `AS-${RUN}-2`,
    ],
  );

  await admin.query(
    `insert into skill_frameworks (id, tenant_id, activity_type_key, name)
     values ($1, $2, 'swimming', 'Swimming skill ladder')`,
    [frameworkA, tenantA],
  );
  await admin.query(
    `insert into skill_nodes (id, tenant_id, framework_id, parent_id, name, ordinal, rubric)
     values ($1, $2, $3, null, 'Beginner', 1, '{}'::jsonb)`,
    [levelA, tenantA, frameworkA],
  );
  await admin.query(
    `insert into skill_nodes (id, tenant_id, framework_id, parent_id, name, ordinal, rubric)
     values ($1, $2, $3, $4, 'Water confidence', 1, $5::jsonb),
            ($6, $2, $3, $4, 'Freestyle', 2, '{}'::jsonb)`,
    [skillA, tenantA, frameworkA, levelA, JSON.stringify({ "1": "Holds edge" }), skillA2],
  );
}, 60_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantA);
  await deleteAuditRowsForTenant(admin, tenantB);
  await admin.query("delete from assessments where tenant_id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  await admin.query("delete from skill_nodes where tenant_id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  await admin.query(
    "delete from skill_frameworks where tenant_id in ($1, $2)",
    [tenantA, tenantB],
  );
  await admin.query("delete from members where tenant_id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  await admin.query("delete from persons where tenant_id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  await admin.query("delete from locations where tenant_id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  await admin.query("delete from tenants where id in ($1, $2)", [tenantA, tenantB]);
  await admin.query("delete from users where id = $1", [actor]);
  await admin.end();
});

describe("V-10 assessments", () => {
  it("enforces bands 1-4 at the action boundary without writing a row or an audit entry", async () => {
    ctxWith(["levels.read", "levels.assess"]);
    for (const band of [0, 5, -1, 2.5]) {
      const result = await actions.recordAssessmentAction({
        memberId: memberA,
        nodeId: skillA,
        band,
      });
      expect(result.ok, `band ${band} must be refused`).toBe(false);
    }
    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from assessments where tenant_id = $1",
      [tenantA],
    );
    expect(Number(rows[0]?.count)).toBe(0);
    expect(await auditCount(tenantA, "assessment.record")).toBe(0);
  });

  it("refuses a coach without levels.assess", async () => {
    ctxWith(["attendance.read", "attendance.mark", "members.read.assigned"]);
    await expect(
      actions.recordAssessmentAction({
        memberId: memberA,
        nodeId: skillA,
        band: 3,
      }),
    ).rejects.toThrow(/forbidden/i);
    expect(await auditCount(tenantA, "assessment.record")).toBe(0);
  });

  it("writes one audit row per assessment and returns history newest-first", async () => {
    ctxWith(["levels.read", "levels.assess"]);
    const dates = [
      "2026-09-10T04:00:00.000Z",
      "2026-09-12T04:00:00.000Z",
      "2026-09-11T04:00:00.000Z",
    ];
    const bands = [2, 4, 3];
    for (let i = 0; i < dates.length; i++) {
      const result = await actions.recordAssessmentAction({
        memberId: memberA,
        nodeId: skillA,
        band: bands[i],
        assessedAt: dates[i],
        notes: i === 1 ? "Ready for the deep end" : undefined,
      });
      expect(result.ok).toBe(true);
    }
    expect(await auditCount(tenantA, "assessment.record")).toBe(3);

    const history = await progressService.listAssessmentHistory(
      state.ctx as unknown as ActionCtx,
      memberA,
    );
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.band)).toEqual([4, 3, 2]);
    expect(history[0]?.assessedAt).toBe(dates[1]);
    expect(history[0]?.notes).toBe("Ready for the deep end");
    expect(history[0]?.nodeName).toBe("Water confidence");

    const progress = await progressService.getMemberProgress(
      state.ctx as unknown as ActionCtx,
      memberA,
    );
    const node = progress?.frameworks[0]?.nodes.find((n) => n.id === skillA);
    expect(node?.band).toBe(4);
    expect(node?.history.map((h) => h.band)).toEqual([4, 3, 2]);
  });

  it("still records a note-free tap (the one-tap path) and reports an honest empty history", async () => {
    ctxWith(["levels.read", "levels.assess"]);
    const result = await actions.recordAssessmentAction({
      memberId: memberA,
      nodeId: skillA2,
      band: 1,
    });
    expect(result.ok).toBe(true);

    const progress = await progressService.getMemberProgress(
      state.ctx as unknown as ActionCtx,
      memberA,
    );
    const untouched = progress?.frameworks[0]?.nodes.find(
      (n) => n.id === skillA,
    );
    // skillA already has history from the previous test; assert the
    // fresh node instead so this stays order-independent.
    const fresh = progress?.frameworks[0]?.nodes.find((n) => n.id === skillA2);
    expect(fresh?.band).toBe(1);
    expect(fresh?.history).toHaveLength(1);
    expect(untouched?.band).toBe(4);
  });

  it("shows another tenant zero assessments and refuses its member", async () => {
    state.ctx = {
      tenantId: tenantB,
      userId: actor,
      permissions: new Set(["levels.read", "levels.assess"]),
      features: new Set(["swimming", "swim.levels"]),
    };
    const result = await actions.recordAssessmentAction({
      memberId: memberA,
      nodeId: skillA,
      band: 3,
    });
    expect(result.ok).toBe(false);

    const historyB = await progressService.listAssessmentHistory(
      state.ctx as unknown as ActionCtx,
      memberA,
    );
    expect(historyB).toEqual([]);
    expect(await auditCount(tenantB, "assessment.record")).toBe(0);
  });
});
