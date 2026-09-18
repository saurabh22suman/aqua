import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { activityTypes } from "@/db/schema/activity-types";
import {
  skillFrameworks,
  skillNodes,
} from "@/db/schema/skill-framework";
import { skillLevels, skills } from "@/db/schema/preset-engine";
import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";

// V-09 — bridge helper. applyPreset seeds the preset-shaped ladder
// (skill_levels/skills); this function mirrors that ladder into the
// generic framework (M-03) in the same transaction, so every new
// tenant has an assessable ladder the moment its preset lands.
//
// The same mapping is implemented in SQL in
// db/migrations/20260918142000_v10_framework_bridge.sql for ladders
// that exist before this feature deploys. Both must agree on ids:
//   * framework id = md5('<tenant_id>:v10:ladder') -> uuid
//   * level node id = skill_levels.id
//   * skill node id = skills.id, parent = its level node
// tests/tier1/skill-ladder.test.ts re-runs the SQL file after this
// helper has bridged a tenant and asserts it inserts nothing.
//
// Idempotent by construction: every insert conflicts on the primary
// key after the first run and does nothing, even after an owner
// renames a node in /owner/settings/skills.

// The M-01 catalogue has no dance/martial-arts key; dance-ma's single
// Belt ladder lands on fitness — the closest progress-capable type.
// Keep this in step with the migration's CASE expression.
const PRESET_ACTIVITY_OVERRIDES: Record<string, string> = {
  "dance-ma": "fitness",
};

export function ladderFrameworkId(tenantId: string): string {
  const hex = createHash("md5")
    .update(`${tenantId}:v10:ladder`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function resolveActivityType(
  tx: TenantTx,
  activityHint: string | null,
): Promise<{ key: string; name: string } | null> {
  const candidate =
    activityHint && PRESET_ACTIVITY_OVERRIDES[activityHint]
      ? PRESET_ACTIVITY_OVERRIDES[activityHint]
      : activityHint;
  if (candidate) {
    const [row] = await tx
      .select({ key: activityTypes.key, name: activityTypes.name })
      .from(activityTypes)
      .where(eq(activityTypes.key, candidate))
      .limit(1);
    if (row) return row;
  }
  const [fallback] = await tx
    .select({ key: activityTypes.key, name: activityTypes.name })
    .from(activityTypes)
    .orderBy(asc(activityTypes.sortOrder), asc(activityTypes.key))
    .limit(1);
  return fallback ?? null;
}

export async function bridgePresetLadder(
  tx: TenantTx,
  tenantId: TenantId,
  activityHint: string | null,
): Promise<void> {
  const levels = await tx
    .select({
      id: skillLevels.id,
      name: skillLevels.name,
      ordinal: skillLevels.ordinal,
    })
    .from(skillLevels)
    .where(eq(skillLevels.tenantId, tenantId))
    .orderBy(asc(skillLevels.ordinal), asc(skillLevels.id));
  if (levels.length === 0) return;

  const activity = await resolveActivityType(tx, activityHint);
  if (!activity) return;

  const frameworkId = ladderFrameworkId(tenantId);
  await tx
    .insert(skillFrameworks)
    .values({
      id: frameworkId,
      tenantId,
      activityTypeKey: activity.key,
      name: `${activity.name} skill ladder`,
      version: 1,
    })
    .onConflictDoNothing({
      target: [skillFrameworks.id, skillFrameworks.tenantId],
    });

  await tx
    .insert(skillNodes)
    .values(
      levels.map((level) => ({
        id: level.id,
        tenantId,
        frameworkId,
        parentId: null,
        name: level.name,
        ordinal: level.ordinal,
        rubric: {},
      })),
    )
    .onConflictDoNothing({ target: [skillNodes.id, skillNodes.tenantId] });

  const levelIds = new Set(levels.map((l) => l.id));
  const skillRows = await tx
    .select({
      id: skills.id,
      skillLevelId: skills.skillLevelId,
      name: skills.name,
      rubric: skills.rubric,
    })
    .from(skills)
    .where(eq(skills.tenantId, tenantId))
    .orderBy(asc(skills.name), asc(skills.id));

  const childCounters = new Map<string, number>();
  const childValues = [];
  for (const skill of skillRows) {
    if (!levelIds.has(skill.skillLevelId)) continue;
    const ordinal = (childCounters.get(skill.skillLevelId) ?? 0) + 1;
    childCounters.set(skill.skillLevelId, ordinal);
    childValues.push({
      id: skill.id,
      tenantId,
      frameworkId,
      parentId: skill.skillLevelId,
      name: skill.name,
      ordinal,
      rubric: skill.rubric,
    });
  }
  if (childValues.length > 0) {
    await tx
      .insert(skillNodes)
      .values(childValues)
      .onConflictDoNothing({ target: [skillNodes.id, skillNodes.tenantId] });
  }
}
