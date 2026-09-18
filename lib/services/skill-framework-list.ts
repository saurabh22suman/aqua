import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { assessments, skillFrameworks, skillNodes } from "@/db/schema/skill-framework";
import type { ActionCtx } from "@/lib/auth/context";

// M-03 — the read half of the skill framework service. Split from
// lib/services/skill-framework.ts to keep every file under the
// 300-line rule (same shape as menu.ts / menu-core.ts).

export type SkillFrameworkNodeRow = {
  id: string;
  parentId: string | null;
  name: string;
  ordinal: number;
  rubric: Record<string, string>;
};

export type SkillFrameworkRow = {
  id: string;
  activityTypeKey: string;
  name: string;
  version: number;
  isActive: boolean;
  nodes: SkillFrameworkNodeRow[];
};

export type AssessmentRow = {
  id: string;
  memberId: string;
  nodeId: string;
  band: number;
  assessedAt: string;
  assessedBy: string | null;
  notes: string | null;
};

export async function listFrameworksByActivityType(
  ctx: ActionCtx,
  activityTypeKey: string,
): Promise<SkillFrameworkRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const frameworks = await tx
      .select()
      .from(skillFrameworks)
      .where(
        and(
          eq(skillFrameworks.tenantId, ctx.tenantId),
          eq(skillFrameworks.activityTypeKey, activityTypeKey),
        ),
      )
      .orderBy(asc(skillFrameworks.name), asc(skillFrameworks.version));
    if (frameworks.length === 0) return [];

    const ids = frameworks.map((f) => f.id);
    const nodes = await tx
      .select()
      .from(skillNodes)
      .where(
        and(
          eq(skillNodes.tenantId, ctx.tenantId),
          inArray(skillNodes.frameworkId, ids),
        ),
      )
      .orderBy(asc(skillNodes.ordinal), asc(skillNodes.name));
    const byFramework = new Map<string, SkillFrameworkNodeRow[]>();
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
      version: framework.version,
      isActive: framework.isActive,
      nodes: byFramework.get(framework.id) ?? [],
    }));
  });
}

export async function listAssessments(
  ctx: ActionCtx,
  memberId: string,
): Promise<AssessmentRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(assessments)
      .where(
        and(
          eq(assessments.tenantId, ctx.tenantId),
          eq(assessments.memberId, memberId),
        ),
      )
      .orderBy(desc(assessments.assessedAt));
    return rows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      nodeId: row.nodeId,
      band: row.band,
      assessedAt: row.assessedAt.toISOString(),
      assessedBy: row.assessedBy,
      notes: row.notes,
    }));
  });
}

