import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import {
  assessments,
  skillFrameworks,
  skillNodes,
} from "@/db/schema/skill-framework";
import { members, persons } from "@/db/schema/people";
import { users } from "@/db/schema/users";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { asMemberId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-10/V-11 — the read half of the assessment story: one member's
// assessment history (newest-first) and the progress view composed
// from the generic framework (M-03) and the assessments recorded
// against its nodes.
//
// A member outside the caller's location scope reads exactly like a
// missing member (null / empty) — the same DPDP answer
// recordAssessment already gives, and the same answer as another
// tenant's member (RLS would hide the rows anyway; the explicit
// tenant predicate keeps the query plan honest).

export type AssessmentHistoryRow = {
  id: string;
  nodeId: string;
  nodeName: string;
  band: number;
  assessedAt: string;
  assessedByName: string | null;
  notes: string | null;
};

export type MemberProgressNode = {
  id: string;
  parentId: string | null;
  name: string;
  ordinal: number;
  rubric: Record<string, string>;
  band: number | null;
  assessedAt: string | null;
  assessedByName: string | null;
  history: AssessmentHistoryRow[];
};

export type MemberProgressFramework = {
  id: string;
  name: string;
  activityTypeKey: string;
  nodes: MemberProgressNode[];
};

export type MemberProgress = {
  memberId: string;
  memberName: string;
  memberCode: string;
  frameworks: MemberProgressFramework[];
};

async function visibleMember(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  ctx: ActionCtx,
  memberId: string,
): Promise<{
  id: string;
  locationId: string | null;
  name: string;
  code: string;
  personId: string;
} | null> {
  const [member] = await tx
    .select({
      id: members.id,
      locationId: members.locationId,
      name: persons.fullName,
      code: members.memberCode,
      personId: members.personId,
    })
    .from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(
      and(
        eq(members.id, asMemberId(memberId)),
        eq(members.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  if (!member) return null;
  const access = await resolveLocationAccess(tx, ctx);
  if (!locationVisible(access, member.locationId)) return null;
  return member;
}

async function loadHistory(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  ctx: ActionCtx,
  memberId: string,
): Promise<AssessmentHistoryRow[]> {
  const rows = await tx
    .select({
      id: assessments.id,
      nodeId: assessments.nodeId,
      nodeName: skillNodes.name,
      band: assessments.band,
      assessedAt: assessments.assessedAt,
      notes: assessments.notes,
      assessorName: persons.fullName,
    })
    .from(assessments)
    .innerJoin(
      skillNodes,
      and(
        eq(skillNodes.id, assessments.nodeId),
        eq(skillNodes.tenantId, assessments.tenantId),
      ),
    )
    .leftJoin(users, eq(users.id, assessments.assessedBy))
    .leftJoin(
      persons,
      and(
        eq(persons.id, users.personId),
        eq(persons.tenantId, assessments.tenantId),
      ),
    )
    .where(
      and(
        eq(assessments.tenantId, ctx.tenantId),
        eq(assessments.memberId, asMemberId(memberId)),
      ),
    )
    .orderBy(desc(assessments.assessedAt), desc(assessments.id));

  return rows.map((row) => ({
    id: row.id,
    nodeId: row.nodeId,
    nodeName: row.nodeName,
    band: row.band,
    assessedAt: row.assessedAt.toISOString(),
    assessedByName: row.assessorName ?? null,
    notes: row.notes,
  }));
}

export async function listAssessmentHistory(
  ctx: ActionCtx,
  memberId: string,
): Promise<AssessmentHistoryRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const member = await visibleMember(tx, ctx, memberId);
    if (!member) return [];
    return loadHistory(tx, ctx, memberId);
  });
}

export async function getMemberProgress(
  ctx: ActionCtx,
  memberId: string,
): Promise<MemberProgress | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const member = await visibleMember(tx, ctx, memberId);
    if (!member) return null;

    const frameworks = await tx
      .select()
      .from(skillFrameworks)
      .where(
        and(
          eq(skillFrameworks.tenantId, ctx.tenantId),
          eq(skillFrameworks.isActive, true),
        ),
      )
      .orderBy(asc(skillFrameworks.name), asc(skillFrameworks.id));

    const frameworkIds = frameworks.map((f) => f.id);
    const nodes =
      frameworkIds.length > 0
        ? await tx
            .select()
            .from(skillNodes)
            .where(
              and(
                eq(skillNodes.tenantId, ctx.tenantId),
                inArray(skillNodes.frameworkId, frameworkIds),
              ),
            )
            .orderBy(asc(skillNodes.ordinal), asc(skillNodes.name))
        : [];

    const history = await loadHistory(tx, ctx, memberId);
    const historyByNode = new Map<string, AssessmentHistoryRow[]>();
    for (const row of history) {
      const list = historyByNode.get(row.nodeId) ?? [];
      list.push(row);
      historyByNode.set(row.nodeId, list);
    }

    const nodesByFramework = new Map<string, MemberProgressNode[]>();
    for (const node of nodes) {
      const nodeHistory = historyByNode.get(node.id) ?? [];
      const latest = nodeHistory[0] ?? null;
      const list = nodesByFramework.get(node.frameworkId) ?? [];
      list.push({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        ordinal: node.ordinal,
        rubric: (node.rubric ?? {}) as Record<string, string>,
        band: latest?.band ?? null,
        assessedAt: latest?.assessedAt ?? null,
        assessedByName: latest?.assessedByName ?? null,
        history: nodeHistory,
      });
      nodesByFramework.set(node.frameworkId, list);
    }

    return {
      memberId: member.id,
      memberName: member.name,
      memberCode: member.code,
      frameworks: frameworks.map((framework) => ({
        id: framework.id,
        name: framework.name,
        activityTypeKey: framework.activityTypeKey,
        nodes: nodesByFramework.get(framework.id) ?? [],
      })),
    };
  });
}
