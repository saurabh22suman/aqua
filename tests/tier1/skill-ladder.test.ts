import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { applyPreset } from "@/db/preset-engine";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// V-09 — skill ladder bridge + editor.
//
// The bridge is a data migration over skill_levels/skills (seeded by
// applyPreset) into the generic skill_frameworks/skill_nodes (M-03).
// The editor edits the generic nodes and audits one row per edit.
//
// Written before the services existed: the first run is deliberately
// red (module-not-found). Fixtures go through the privileged pool
// (tenants and skill_levels are under FORCE RLS); every app operation
// goes through withTenant()/the services, so RLS and the audit
// assertions exercise the real path.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const MIGRATION_FILE = join(
  process.cwd(),
  "db/migrations/20260918142000_v10_framework_bridge.sql",
);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const tenantC = asTenantId(uuidv7());
let actor: UserId;
// applyPreset audits the platform-side apply with a platform_users
// actor (platform_audit_log.actor_id is an FK); the ladder editor
// audits the tenant-side with a users row.
let platformActor: UserId;

const ctxA = { tenantId: tenantA, userId: "" as UserId };
const ctxB = { tenantId: tenantB, userId: "" as UserId };
const ctxC = { tenantId: tenantC, userId: "" as UserId };

// Tenant A — a two-level swimming ladder.
const levelA1 = uuidv7();
const levelA2 = uuidv7();
const skillA1 = uuidv7();
const skillA2 = uuidv7();
const skillA3 = uuidv7();
// Tenant B — a one-level dance/martial-arts ladder.
const levelB1 = uuidv7();
const skillB1 = uuidv7();

const RUBRIC = {
  "1": "Holds pool edge",
  "2": "Floats with support",
  "3": "Floats independently",
  "4": "Comfortable in the deep end",
};

let ladder: typeof import("@/lib/services/skill-ladder");
let bridge: typeof import("@/lib/services/skill-ladder-bridge");

async function auditCount(tenantId: TenantId, action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]?.count ?? "0");
}

async function seedLadder(
  tenantId: TenantId,
  levels: Array<{ id: string; name: string; ordinal: number }>,
  skills: Array<{ id: string; levelId: string; name: string; rubric: object }>,
  presetKey: string,
): Promise<void> {
  for (const l of levels) {
    await admin.query(
      `insert into skill_levels (id, tenant_id, name, ordinal, is_sample)
       values ($1, $2, $3, $4, true)`,
      [l.id, tenantId, l.name, l.ordinal],
    );
  }
  for (const s of skills) {
    await admin.query(
      `insert into skills (id, tenant_id, skill_level_id, name, rubric, is_sample)
       values ($1, $2, $3, $4, $5::jsonb, true)`,
      [s.id, tenantId, s.levelId, s.name, JSON.stringify(s.rubric)],
    );
  }
  await admin.query(
    "update tenants set preset_key = $2, preset_version = 1 where id = $1",
    [tenantId, presetKey],
  );
}

beforeAll(async () => {
  ladder = await import("@/lib/services/skill-ladder");
  bridge = await import("@/lib/services/skill-ladder-bridge");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Ladder A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Ladder B', 'active', 'Asia/Kolkata'),
       ($5, $6, 'Ladder C', 'active', 'Asia/Kolkata')`,
    [
      tenantA,
      `v09-a-${RUN}`,
      tenantB,
      `v09-b-${RUN}`,
      tenantC,
      `v09-c-${RUN}`,
    ],
  );
  const { rows } = await admin.query<{ id: string }>(
    "insert into users (id, phone) values ($1, $2) returning id",
    [uuidv7(), `+9193${String(Date.now()).slice(-8)}`],
  );
  actor = asUserId(rows[0]!.id);
  const platform = await admin.query<{ id: string }>(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'V-09 test operator', 'h', 's', 'admin', 'active')
     returning id`,
    [uuidv7(), `v09-${RUN}@platform.test`],
  );
  platformActor = asUserId(platform.rows[0]!.id);
  ctxA.userId = actor;
  ctxB.userId = actor;
  ctxC.userId = actor;

  await seedLadder(
    tenantA,
    [
      { id: levelA1, name: "Beginner", ordinal: 1 },
      { id: levelA2, name: "Intermediate", ordinal: 2 },
    ],
    [
      { id: skillA1, levelId: levelA1, name: "Water confidence", rubric: RUBRIC },
      {
        id: skillA2,
        levelId: levelA1,
        name: "Freestyle",
        rubric: { "1": "Cannot coordinate", "2": "Short bursts", "3": "Laps", "4": "Efficient" },
      },
      {
        id: skillA3,
        levelId: levelA2,
        name: "Backstroke",
        rubric: { "1": "Cannot coordinate", "2": "25 m with breaks", "3": "50 m", "4": "100 m" },
      },
    ],
    "swimming",
  );
  await seedLadder(
    tenantB,
    [{ id: levelB1, name: "Belt", ordinal: 1 }],
    [{ id: skillB1, levelId: levelB1, name: "Form", rubric: RUBRIC }],
    "dance-ma",
  );

  // The production hook bridges inside applyPreset's tenant transaction.
  await withTenant(tenantA, (tx) =>
    bridge.bridgePresetLadder(tx, tenantA, "swimming"),
  );
  await withTenant(tenantB, (tx) =>
    bridge.bridgePresetLadder(tx, tenantB, "dance-ma"),
  );
}, 60_000);

afterAll(async () => {
  for (const tenantId of [tenantA, tenantB, tenantC]) {
    await deleteAuditRowsForTenant(admin, tenantId);
    await admin.query("delete from assessments where tenant_id = $1", [tenantId]);
    await admin.query("delete from skill_nodes where tenant_id = $1", [tenantId]);
    await admin.query("delete from skill_frameworks where tenant_id = $1", [tenantId]);
    await admin.query("delete from skills where tenant_id = $1", [tenantId]);
    await admin.query("delete from skill_levels where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenant_features where tenant_id = $1", [tenantId]);
    await admin.query("delete from role_permissions where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from message_templates where tenant_id = $1", [tenantId]);
    await admin.query("delete from plan_shapes where tenant_id = $1", [tenantId]);
    await admin.query("delete from facility_sub_units where tenant_id = $1", [tenantId]);
    await admin.query("delete from facilities where tenant_id = $1", [tenantId]);
    await admin.query("delete from location_presets where tenant_id = $1", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.query("delete from users where id = $1", [actor]);
  await admin.query(
    "delete from platform_audit_log where actor_id = $1",
    [platformActor],
  );
  await admin.query("delete from platform_users where id = $1", [platformActor]);
  await admin.end();
});

describe("V-09 bridge: preset ladder -> generic framework", () => {
  it("maps level.ordinal -> node and skill -> child node with its rubric", async () => {
    const ladders = await ladder.listSkillLadders(ctxA);
    expect(ladders).toHaveLength(1);
    const nodes = ladders[0]!.nodes;
    expect(nodes.map((n) => n.name).sort()).toEqual([
      "Backstroke",
      "Beginner",
      "Freestyle",
      "Intermediate",
      "Water confidence",
    ]);

    const beginner = nodes.find((n) => n.id === levelA1);
    expect(beginner?.parentId).toBeNull();
    expect(beginner?.ordinal).toBe(1);

    const confidence = nodes.find((n) => n.id === skillA1);
    expect(confidence?.parentId).toBe(levelA1);
    expect(confidence?.rubric).toEqual(RUBRIC);

    // dance-ma resolves to the closest catalogue type (fitness).
    const laddersB = await ladder.listSkillLadders(ctxB);
    expect(laddersB).toHaveLength(1);
    expect(laddersB[0]?.activityTypeKey).toBe("fitness");
    expect(laddersB[0]?.nodes).toHaveLength(2);
  });

  it("is idempotent: re-running the migration inserts nothing, even after a rename", async () => {
    const renamed = await ladder.updateSkillLevel(ctxA, {
      nodeId: levelA1,
      name: "Beginner plus",
    });
    expect(renamed.ok).toBe(true);

    const before = await admin.query<{ count: string }>(
      "select count(*)::text as count from skill_nodes where tenant_id = $1",
      [tenantA],
    );
    expect(Number(before.rows[0]?.count)).toBe(5);

    // Re-run the real migration file inside a rolled-back transaction.
    // The deterministic ids (framework = md5(tenant:'v10:ladder'),
    // nodes = source ids) are what make the re-run a no-op — list
    // assertions happen before the rollback.
    const client = await admin.connect();
    try {
      await client.query("begin");
      const sqlText = readFileSync(MIGRATION_FILE, "utf8");
      await client.query(sqlText);
      const after = await client.query<{ count: string }>(
        "select count(*)::text as count from skill_nodes where tenant_id = $1",
        [tenantA],
      );
      expect(Number(after.rows[0]?.count), "re-run must insert nothing").toBe(5);
      const frameworks = await client.query<{ count: string }>(
        "select count(*)::text as count from skill_frameworks where tenant_id = $1",
        [tenantA],
      );
      expect(Number(frameworks.rows[0]?.count)).toBe(1);
      const name = await client.query<{ name: string }>(
        "select name from skill_nodes where id = $1",
        [levelA1],
      );
      expect(name.rows[0]?.name).toBe("Beginner plus");
      await client.query("rollback");
    } finally {
      client.release();
    }

    // Revert so later assertions start from the bridged name.
    await ladder.updateSkillLevel(ctxA, {
      nodeId: levelA1,
      name: "Beginner",
    });
  });

  it("edits a level and writes exactly one skill_level.update audit row", async () => {
    const before = await auditCount(tenantA, "skill_level.update");
    const result = await ladder.updateSkillLevel(ctxA, {
      nodeId: levelA1,
      name: "Novice",
    });
    expect(result.ok).toBe(true);

    const nodes = (await ladder.listSkillLadders(ctxA))[0]!.nodes;
    expect(nodes.find((n) => n.id === levelA1)?.name).toBe("Novice");
    expect(await auditCount(tenantA, "skill_level.update")).toBe(before + 1);
  });

  it("edits a skill name and rubric with one skill_node.update audit row", async () => {
    const before = await auditCount(tenantA, "skill_node.update");
    const result = await ladder.updateSkillNode(ctxA, {
      nodeId: skillA1,
      name: "Water confidence (revised)",
      rubric: { ...RUBRIC, "4": "Deep end, calm breathing" },
    });
    expect(result.ok).toBe(true);

    const node = (await ladder.listSkillLadders(ctxA))[0]!.nodes.find(
      (n) => n.id === skillA1,
    );
    expect(node?.name).toBe("Water confidence (revised)");
    expect(node?.rubric["4"]).toBe("Deep end, calm breathing");
    expect(await auditCount(tenantA, "skill_node.update")).toBe(before + 1);
  });

  it("lists zero rows and refuses edits across tenants", async () => {
    const bLadders = await ladder.listSkillLadders(ctxB);
    expect(bLadders.flatMap((l) => l.nodes).map((n) => n.id)).not.toContain(
      levelA1,
    );

    const refused = await ladder.updateSkillLevel(ctxB, {
      nodeId: levelA1,
      name: "Hijacked",
    });
    expect(refused.ok).toBe(false);

    const refusedNode = await ladder.updateSkillNode(ctxB, {
      nodeId: skillA1,
      name: "Hijacked",
    });
    expect(refusedNode.ok).toBe(false);

    expect(await auditCount(tenantB, "skill_level.update")).toBe(0);
    expect(await auditCount(tenantB, "skill_node.update")).toBe(0);
    const name = await admin.query<{ name: string }>(
      "select name from skill_nodes where id = $1",
      [levelA1],
    );
    expect(name.rows[0]?.name).toBe("Novice");
  });

  it("applyPreset bridges the ladder it seeds (the new-tenant path)", async () => {
    const result = await applyPreset(tenantC, "swimming", {
      actorId: platformActor,
    });
    expect(result.kind).toBe("ok");

    const ladders = await ladder.listSkillLadders(ctxC);
    expect(ladders).toHaveLength(1);
    const levels = ladders[0]!.nodes.filter((n) => n.parentId === null);
    const children = ladders[0]!.nodes.filter((n) => n.parentId !== null);
    expect(levels.length).toBeGreaterThanOrEqual(3);
    expect(children.length).toBeGreaterThanOrEqual(8);
    // Every child hangs off a level node in the same framework.
    const levelIds = new Set(levels.map((n) => n.id));
    for (const child of children) {
      expect(levelIds.has(child.parentId!)).toBe(true);
    }
  }, 60_000);
});
