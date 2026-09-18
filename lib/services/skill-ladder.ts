import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  skillFrameworks,
  skillNodes,
} from "@/db/schema/skill-framework";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";

export * from "./skill-ladder-bridge";

// V-09 — the ladder editor service. The bridge
// (lib/services/skill-ladder-bridge.ts) mirrors the preset-shaped
// skill_levels/skills into the generic framework; from there the
// owner edits the generic nodes on /owner/settings/skills.
//
// Every update audits exactly one row in the same transaction:
//   * a level edit   -> skill_level.update
//   * a skill edit   -> skill_node.update
// Cross-tenant refusals write nothing: the tenant predicate plus RLS
// make another academy's node invisible, so the "not found" branch is
// the same answer for "doesn't exist" and "isn't yours".

export type SkillLadderNodeRow = {
  id: string;
  parentId: string | null;
  name: string;
  ordinal: number;
  rubric: Record<string, string>;
};

export type SkillLadderRow = {
  id: string;
  activityTypeKey: string;
  name: string;
  nodes: SkillLadderNodeRow[];
};

export type LadderMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const nameSchema = z.string().trim().min(1).max(120);
const rubricSchema = z.record(
  z.enum(["1", "2", "3", "4"]),
  z.string().trim().max(2_000),
);

export const updateSkillLevelInput = z.object({
  nodeId: z.string().uuid(),
  name: nameSchema,
});

export const updateSkillNodeInput = z.object({
  nodeId: z.string().uuid(),
  name: nameSchema,
  rubric: rubricSchema.optional(),
});

export async function listSkillLadders(
  ctx: ActionCtx,
): Promise<SkillLadderRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const frameworks = await tx
      .select()
      .from(skillFrameworks)
      .where(eq(skillFrameworks.tenantId, ctx.tenantId))
      .orderBy(asc(skillFrameworks.name), asc(skillFrameworks.id));
    if (frameworks.length === 0) return [];

    const nodes = await tx
      .select()
      .from(skillNodes)
      .where(
        and(
          eq(skillNodes.tenantId, ctx.tenantId),
          inArray(
            skillNodes.frameworkId,
            frameworks.map((f) => f.id),
          ),
        ),
      )
      .orderBy(asc(skillNodes.ordinal), asc(skillNodes.name));

    const byFramework = new Map<string, SkillLadderNodeRow[]>();
    for (const node of nodes) {
      const list = byFramework.get(node.frameworkId) ?? [];
      list.push({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        ordinal: node.ordinal,
        rubric: (node.rubric ?? {}) as Record<string, string>,
      });
      byFramework.set(node.frameworkId, list);
    }

    return frameworks.map((framework) => ({
      id: framework.id,
      activityTypeKey: framework.activityTypeKey,
      name: framework.name,
      nodes: byFramework.get(framework.id) ?? [],
    }));
  });
}

export async function updateSkillLevel(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LadderMutationResult> {
  const parsed = updateSkillLevelInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid skill level.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const [node] = await tx
      .select()
      .from(skillNodes)
      .where(
        and(
          eq(skillNodes.id, parsed.data.nodeId),
          eq(skillNodes.tenantId, ctx.tenantId),
          isNull(skillNodes.parentId),
        ),
      )
      .limit(1);
    if (!node) return { ok: false, error: "Skill level not found." };

    await tx
      .update(skillNodes)
      .set({
        name: parsed.data.name,
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? null,
      })
      .where(
        and(
          eq(skillNodes.id, node.id),
          eq(skillNodes.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "skill_level.update",
      entityType: "skill_level",
      entityId: node.id,
      before: { name: node.name },
      after: { name: parsed.data.name },
      changedFields: ["name"],
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, id: node.id };
  });
}

export async function updateSkillNode(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LadderMutationResult> {
  const parsed = updateSkillNodeInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid skill.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const [node] = await tx
      .select()
      .from(skillNodes)
      .where(
        and(
          eq(skillNodes.id, parsed.data.nodeId),
          eq(skillNodes.tenantId, ctx.tenantId),
          isNotNull(skillNodes.parentId),
        ),
      )
      .limit(1);
    if (!node) return { ok: false, error: "Skill not found." };

    const before = (node.rubric ?? {}) as Record<string, string>;
    const rubric = parsed.data.rubric
      ? { ...before, ...parsed.data.rubric }
      : before;
    const changedFields = ["name"];
    if (parsed.data.rubric) changedFields.push("rubric");

    await tx
      .update(skillNodes)
      .set({
        name: parsed.data.name,
        rubric,
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? null,
      })
      .where(
        and(
          eq(skillNodes.id, node.id),
          eq(skillNodes.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "skill_node.update",
      entityType: "skill_node",
      entityId: node.id,
      before: { name: node.name, rubric: before },
      after: { name: parsed.data.name, rubric },
      changedFields,
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, id: node.id };
  });
}
