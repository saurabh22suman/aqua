import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// M-03 — generic skill framework. First run is deliberately red: the
// skill_frameworks / skill_nodes / assessments tables and
// lib/services/skill-framework.ts do not exist. Fixtures (tenants,
// members) go through the privileged migration pool; every app
// operation goes through the service under withTenant(), so the RLS
// and audit assertions exercise the real path.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const actor = asUserId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const personA = uuidv7();
const memberA = asMemberId(uuidv7());

const ctxA = { tenantId: tenantA, userId: actor };
const ctxB = { tenantId: tenantB, userId: actor };

let svc: typeof import("@/lib/services/skill-framework");

async function auditCount(action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantA, action],
  );
  return Number(rows[0]?.count ?? "0");
}

beforeAll(async () => {
  svc = await import("@/lib/services/skill-framework");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Skill A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Skill B', 'active', 'Asia/Kolkata')`,
    [tenantA, `m03-a-${RUN}`, tenantB, `m03-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Main A', true), ($2, $4, 'Main B', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9192${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Skill Member')",
    [personA, tenantA],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code)
     values ($1, $2, $3, $4, 'active', $5)`,
    [memberA, tenantA, personA, locA, `SK-${RUN}`],
  );
}, 60_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantA);
  await deleteAuditRowsForTenant(admin, tenantB);
  await admin.query(
    "delete from assessments where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from skill_nodes where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from skill_frameworks where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from members where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from persons where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from locations where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from roles where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from tenants where id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query("delete from users where id = $1::uuid", [actor]);
  await admin.end();
});

describe("M-03 generic skill framework", () => {
  let frameworkId = "";
  let freestyleNodeId = "";

  it("creates a framework with nodes and lists it by activity type", async () => {
    const created = await svc.createSkillFramework(ctxA, {
      activityTypeKey: "swimming",
      name: "Swim ladder",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    frameworkId = created.id;

    const level = await svc.createSkillNode(ctxA, {
      frameworkId,
      name: "Beginner",
      ordinal: 1,
      rubric: { "1": "Holds edge", "2": "Floats", "3": "Swims", "4": "Deep end" },
    });
    expect(level.ok).toBe(true);
    if (!level.ok) return;

    const child = await svc.createSkillNode(ctxA, {
      frameworkId,
      parentId: level.id,
      name: "Freestyle",
      ordinal: 2,
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    freestyleNodeId = child.id;

    const frameworks = await svc.listFrameworksByActivityType(ctxA, "swimming");
    expect(frameworks).toHaveLength(1);
    expect(frameworks[0]?.id).toBe(frameworkId);
    expect(frameworks[0]?.nodes.map((n) => n.name)).toEqual([
      "Beginner",
      "Freestyle",
    ]);
    expect(frameworks[0]?.nodes[1]?.parentId).toBe(level.id);

    const none = await svc.listFrameworksByActivityType(ctxA, "tennis");
    expect(none).toEqual([]);
  });

  it("shows another tenant zero rows", async () => {
    const other = await svc.listFrameworksByActivityType(ctxB, "swimming");
    expect(other).toEqual([]);

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from skill_frameworks where tenant_id = $1",
      [tenantB],
    );
    expect(rows[0]?.count).toBe("0");
  });

  it("refuses a node whose parent belongs to another framework", async () => {
    const otherFramework = await svc.createSkillFramework(ctxA, {
      activityTypeKey: "tennis",
      name: "Tennis ladder",
    });
    expect(otherFramework.ok).toBe(true);
    if (!otherFramework.ok) return;

    const bad = await svc.createSkillNode(ctxA, {
      frameworkId: otherFramework.id,
      parentId: freestyleNodeId,
      name: "Orphan",
      ordinal: 1,
    });
    expect(bad.ok).toBe(false);
  });

  it("refuses bands outside 1-4 without writing a row or an audit entry", async () => {
    for (const band of [0, 5, -1]) {
      const result = await svc.recordAssessment(ctxA, {
        memberId: memberA,
        nodeId: freestyleNodeId,
        band,
      });
      expect(result.ok, `band ${band} must be refused`).toBe(false);
    }

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from assessments where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.count).toBe("0");
    expect(await auditCount("assessment.record")).toBe(0);
  });

  it("writes exactly one audit row per assessment", async () => {
    const first = await svc.recordAssessment(ctxA, {
      memberId: memberA,
      nodeId: freestyleNodeId,
      band: 3,
      notes: "First pass",
    });
    expect(first.ok).toBe(true);

    const second = await svc.recordAssessment(ctxA, {
      memberId: memberA,
      nodeId: freestyleNodeId,
      band: 4,
    });
    expect(second.ok).toBe(true);

    expect(await auditCount("assessment.record")).toBe(2);

    const { rows } = await admin.query<{ band: number }>(
      "select band from assessments where tenant_id = $1 order by band",
      [tenantA],
    );
    expect(rows.map((r) => r.band)).toEqual([3, 4]);

    const listed = await svc.listAssessments(ctxA, memberA);
    expect(listed).toHaveLength(2);
  });

  it("refuses an assessment against another tenant's node", async () => {
    const result = await svc.recordAssessment(ctxB, {
      memberId: memberA,
      nodeId: freestyleNodeId,
      band: 2,
    });
    expect(result.ok).toBe(false);
    expect(await auditCount("assessment.record")).toBe(2);
  });
});
