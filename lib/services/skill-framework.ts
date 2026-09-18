import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  assessments,
  skillFrameworks,
  skillNodes,
} from "@/db/schema/skill-framework";
import { activityTypes } from "@/db/schema/activity-types";
import { members } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import { asMemberId } from "@/lib/ids";
import { isUniqueViolation } from "@/lib/pg-errors";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";

export * from "./skill-framework-list";

// M-03 — generic skill framework service. Frameworks and nodes are
// tenant data (withTenant); the activity type they hang off is the
// platform catalogue. Assessments record band 1-4 and audit in the
// same transaction via writeAudit, so one assessment is one audit row.
//
// Nothing here branches on the activity type key: a tennis ladder and
// a swim ladder are the same rows. The `progress` capability gates the
// UI, not this service.

export type SkillMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const nameSchema = z.string().trim().min(1).max(120);

export const createFrameworkInput = z.object({
  activityTypeKey: z.string().trim().min(1).max(60),
  name: nameSchema,
  version: z.number().int().min(1).max(1000).optional(),
});

export const createNodeInput = z.object({
  frameworkId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  name: nameSchema,
  ordinal: z.number().int().min(1).max(10_000),
  rubric: z.record(z.string(), z.string().trim().max(2_000)).optional(),
});

export const recordAssessmentInput = z.object({
  memberId: z.string().uuid(),
  nodeId: z.string().uuid(),
  band: z.number().int().min(1).max(4),
  assessedAt: z.string().datetime().optional(),
  notes: z.string().trim().max(2_000).optional(),
});

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

export async function createSkillFramework(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SkillMutationResult> {
  const parsed = createFrameworkInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid framework." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const typeRows = await tx
      .select({ key: activityTypes.key })
      .from(activityTypes)
      .where(eq(activityTypes.key, parsed.data.activityTypeKey))
      .limit(1);
    if (!typeRows[0]) {
      return { ok: false, error: "Unknown activity type." };
    }

    const id = uuidv7();
    try {
      await tx.insert(skillFrameworks).values({
        id,
        tenantId: ctx.tenantId,
        activityTypeKey: parsed.data.activityTypeKey,
        name: parsed.data.name,
        version: parsed.data.version ?? 1,
        createdBy: ctx.userId ?? null,
        updatedBy: ctx.userId ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { ok: false, error: "A framework with this name already exists." };
      }
      throw err;
    }

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "skill_framework.create",
      entityType: "skill_framework",
      entityId: id,
      after: {
        activityTypeKey: parsed.data.activityTypeKey,
        name: parsed.data.name,
        version: parsed.data.version ?? 1,
      },
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, id };
  });
}

export async function createSkillNode(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SkillMutationResult> {
  const parsed = createNodeInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid node." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const frameworkRows = await tx
      .select({ id: skillFrameworks.id })
      .from(skillFrameworks)
      .where(
        and(
          eq(skillFrameworks.id, parsed.data.frameworkId),
          eq(skillFrameworks.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!frameworkRows[0]) {
      return { ok: false, error: "Framework not found." };
    }

    if (parsed.data.parentId) {
      const parentRows = await tx
        .select({ id: skillNodes.id })
        .from(skillNodes)
        .where(
          and(
            eq(skillNodes.id, parsed.data.parentId),
            eq(skillNodes.tenantId, ctx.tenantId),
            eq(skillNodes.frameworkId, parsed.data.frameworkId),
          ),
        )
        .limit(1);
      if (!parentRows[0]) {
        return { ok: false, error: "Parent node not found in this framework." };
      }
    }

    const id = uuidv7();
    await tx.insert(skillNodes).values({
      id,
      tenantId: ctx.tenantId,
      frameworkId: parsed.data.frameworkId,
      parentId: parsed.data.parentId ?? null,
      name: parsed.data.name,
      ordinal: parsed.data.ordinal,
      rubric: parsed.data.rubric ?? {},
      createdBy: ctx.userId ?? null,
      updatedBy: ctx.userId ?? null,
    });

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "skill_node.create",
      entityType: "skill_node",
      entityId: id,
      after: {
        frameworkId: parsed.data.frameworkId,
        parentId: parsed.data.parentId ?? null,
        name: parsed.data.name,
        ordinal: parsed.data.ordinal,
      },
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, id };
  });
}

export async function recordAssessment(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SkillMutationResult> {
  const parsed = recordAssessmentInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid assessment." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const memberRows = await tx
      .select({ id: members.id, locationId: members.locationId })
      .from(members)
      .where(
        and(
          eq(members.id, asMemberId(parsed.data.memberId)),
          eq(members.tenantId, ctx.tenantId),
          isNull(members.deletedAt),
        ),
      )
      .limit(1);
    const member = memberRows[0];
    if (!member) {
      return { ok: false, error: "Member not found." };
    }
    // O-08 — a location-scoped caller cannot assess a member outside
    // their locations. Same answer as a missing member.
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, member.locationId)) {
      return { ok: false, error: "Member not found." };
    }

    const nodeRows = await tx
      .select({ id: skillNodes.id })
      .from(skillNodes)
      .where(
        and(
          eq(skillNodes.id, parsed.data.nodeId),
          eq(skillNodes.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!nodeRows[0]) {
      return { ok: false, error: "Skill node not found." };
    }

    const id = uuidv7();
    await tx.insert(assessments).values({
      id,
      tenantId: ctx.tenantId,
      memberId: parsed.data.memberId,
      nodeId: parsed.data.nodeId,
      band: parsed.data.band,
      assessedBy: ctx.userId ?? null,
      assessedAt: parsed.data.assessedAt
        ? new Date(parsed.data.assessedAt)
        : new Date(),
      notes: parsed.data.notes ?? null,
    });

    // One assessment, one audit row — same transaction.
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      action: "assessment.record",
      entityType: "assessment",
      entityId: id,
      after: {
        memberId: parsed.data.memberId,
        nodeId: parsed.data.nodeId,
        band: parsed.data.band,
      },
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, id };
  });
}
