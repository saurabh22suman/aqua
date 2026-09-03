import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant } from "./tenant";
import {
  facilities,
  facilitySubUnits,
  messageTemplates,
  planShapes,
  skillLevels,
  skills,
} from "./schema/preset-engine";
import { programs, batches } from "./schema/programs";
import { sessions } from "./schema/scheduling";
import { platformAuditLog } from "./schema/platform-users";
import type { TenantId, UserId } from "@/lib/ids";

// Phase 2.3 — "remove sample data" affordance. The applyPreset
// engine flags every row it seeds with `is_sample = true` (see
// db/preset-engine.ts). This service is the inverse: it deletes
// every sample row on the tenant in one transaction so the operator
// can wipe the seeded scaffold with one click.
//
// The affordance hides the moment a non-sample row appears in
// programs or batches — the rule is "anything real attaches",
// which we read as: a real program or a real batch is present
// in the same table the sample rows are in. A real skill level or
// a real plan shape doesn't count: those are sub-entities of a
// program. (That matches how the operator's mental model works —
// a "real" program has its own skill levels and plan shapes by
// construction.)
//
// Hard delete, not soft delete: the applyPreset engine's audit
// row (in `platform_audit_log`) is the durable record of what was
// seeded. The `is_sample` flag also stays on the row from the
// moment it was inserted, so a `select … from programs where
// deleted_at is null` after the wipe returns the live real data
// — and a developer curious what was there can `select … from
// programs where id = '<x>'` if any audit row references the id
// (Postgres keeps the row only if a soft delete was used, but
// with hard delete the audit row's `detail.counts` carries the
// seed shape for reconstruction).
//
// One transaction, full rollback on any failure. The delete is
// scoped to `is_sample = true AND deleted_at IS NULL` — already
// soft-deleted rows are skipped so a partial / pre-existing
// "remove sample data" call doesn't double-count.

export type RemoveSampleDataResult =
  | {
      kind: "ok";
      counts: {
        programs: number;
        batches: number;
        skillLevels: number;
        skills: number;
        planShapes: number;
        facilities: number;
        facilitySubUnits: number;
        messageTemplates: number;
      };
    }
  | {
      kind: "lock_active";
      reason: "real_row_exists";
      message: string;
    }
  | { kind: "tenant_not_found"; message: string };

export async function removeSampleData(
  tenantId: TenantId,
  ctx: { actorId: UserId },
): Promise<RemoveSampleDataResult> {
  return withTenant(tenantId, async (tx) => {
    // 1. Tenant must exist.
    const tenantRows = await tx
      .select({ id: sql`gen_random_uuid()` })
      .from(sql`tenants`)
      .where(sql`tenants.id = ${tenantId}::uuid`)
      .limit(1);
    if (tenantRows.length === 0) {
      return {
        kind: "tenant_not_found",
        message: "No tenant with that id.",
      };
    }

    // 2. Lock: any non-sample row in programs or batches blocks the
    // removal. This is the audit-trail source of truth — the UI
    // hides the button, but the action itself also refuses, so a
    // direct API call can't wipe a real program.
    const realRows = await tx
      .select({ kind: sql<string>`'programs-or-batches'` })
      .from(programs)
      .where(
        and(
          eq(programs.tenantId, tenantId),
          eq(programs.isSample, false),
          isNull(programs.deletedAt),
        ),
      )
      .limit(1)
      .union(
        tx
          .select({ kind: sql<string>`'programs-or-batches'` })
          .from(batches)
          .where(
            and(
              eq(batches.tenantId, tenantId),
              eq(batches.isSample, false),
              isNull(batches.deletedAt),
            ),
          )
          .limit(1),
      );
    if (realRows.length > 0) {
      return {
        kind: "lock_active",
        reason: "real_row_exists",
        message:
          "This tenant has a real (non-sample) program or batch. Remove sample data is hidden once anything real attaches — edit by hand.",
      };
    }

    // 3. Delete sample rows on every preset-seeded table. One
    // transaction. Order: sessions (FK on sessions.batch_id, E1 —
    // applyPreset materialises sessions for example batches now, so
    // a sample batch can carry real session rows by the time this
    // runs) → batches → programs (FK on batches.program_id) →
    // skill_levels → skills (FK on skills.skill_level_id) →
    // plan_shapes → facilities → facility_sub_units (FK on
    // sub_units.facility_id) → message_templates. The CASCADE order
    // matters — the architecture's FK constraints don't ON DELETE
    // CASCADE for these tables; explicit ordering keeps the test
    // fixture's cleanup happy and the audit log row count consistent.
    const sampleBatchIds = await tx
      .select({ id: batches.id })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, tenantId),
          eq(batches.isSample, true),
          isNull(batches.deletedAt),
        ),
      );
    if (sampleBatchIds.length > 0) {
      await tx.delete(sessions).where(
        and(
          eq(sessions.tenantId, tenantId),
          inArray(
            sessions.batchId,
            sampleBatchIds.map((b) => b.id),
          ),
        ),
      );
    }

    const deletedBatches = await tx
      .delete(batches)
      .where(
        and(
          eq(batches.tenantId, tenantId),
          eq(batches.isSample, true),
          isNull(batches.deletedAt),
        ),
      )
      .returning({ id: batches.id });

    const deletedPrograms = await tx
      .delete(programs)
      .where(
        and(
          eq(programs.tenantId, tenantId),
          eq(programs.isSample, true),
          isNull(programs.deletedAt),
        ),
      )
      .returning({ id: programs.id });

    const deletedSkillLevels = await tx
      .delete(skillLevels)
      .where(
        and(
          eq(skillLevels.tenantId, tenantId),
          eq(skillLevels.isSample, true),
        ),
      )
      .returning({ id: skillLevels.id });

    const deletedSkills = await tx
      .delete(skills)
      .where(
        and(
          eq(skills.tenantId, tenantId),
          eq(skills.isSample, true),
        ),
      )
      .returning({ id: skills.id });

    const deletedPlanShapes = await tx
      .delete(planShapes)
      .where(
        and(
          eq(planShapes.tenantId, tenantId),
          eq(planShapes.isSample, true),
        ),
      )
      .returning({ id: planShapes.id });

    const deletedFacilities = await tx
      .delete(facilities)
      .where(
        and(
          eq(facilities.tenantId, tenantId),
          eq(facilities.isSample, true),
        ),
      )
      .returning({ id: facilities.id });

    // Sub-units: only those belonging to a facility that was just
    // deleted. Use the IDs we just collected; if no facilities
    // were deleted, the sub-units are either gone already or
    // non-sample (operator-added). The IN-clause is empty in that
    // case, which means delete-zero-rows.
    const facilityIds = deletedFacilities.map((r) => r.id);
    const deletedSubUnits = facilityIds.length
      ? await tx
          .delete(facilitySubUnits)
          .where(
            and(
              eq(facilitySubUnits.tenantId, tenantId),
              inArray(facilitySubUnits.facilityId, facilityIds),
            ),
          )
          .returning({ id: facilitySubUnits.id })
      : [];

    const deletedMessageTemplates = await tx
      .delete(messageTemplates)
      .where(
        and(
          eq(messageTemplates.tenantId, tenantId),
          eq(messageTemplates.isSample, true),
        ),
      )
      .returning({ id: messageTemplates.id });

    // 4. Audit row. platform_audit_log is the platform operator's
    // audit channel; the engine's "applied preset" actions write
    // there too. This row records what the operator removed, with
    // the row counts per entity.
    await tx.insert(platformAuditLog).values({
      actorId: ctx.actorId,
      tenantId,
      action: "tenant.remove_sample_data",
      targetType: "tenant",
      targetId: null,
      detail: {
        counts: {
          programs: deletedPrograms.length,
          batches: deletedBatches.length,
          skillLevels: deletedSkillLevels.length,
          skills: deletedSkills.length,
          planShapes: deletedPlanShapes.length,
          facilities: deletedFacilities.length,
          facilitySubUnits: deletedSubUnits.length,
          messageTemplates: deletedMessageTemplates.length,
        },
      },
    });

    return {
      kind: "ok",
      counts: {
        programs: deletedPrograms.length,
        batches: deletedBatches.length,
        skillLevels: deletedSkillLevels.length,
        skills: deletedSkills.length,
        planShapes: deletedPlanShapes.length,
        facilities: deletedFacilities.length,
        facilitySubUnits: deletedSubUnits.length,
        messageTemplates: deletedMessageTemplates.length,
      },
    };
  });
}
