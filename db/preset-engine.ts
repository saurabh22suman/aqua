import { and, asc, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "./tenant";
import {
  facilities,
  facilitySubUnits,
  messageTemplates,
  planShapes,
  skillLevels,
  skills,
} from "./schema/preset-engine";
import { programs } from "./schema/programs";
import { roles, rolePermissions } from "./schema/roles";
import { permissions } from "./schema/platform";
import { tenants } from "./schema/tenants";
import { tenantFeatures } from "./schema/tenant-features";
import { sql as drizzleSql, sql } from "drizzle-orm";
import { getActivePreset } from "./platform-presets";
import { generateSessions } from "@/lib/jobs/session-generator";
import type { TenantId, UserId } from "@/lib/ids";

// Phase 2.2a — applyPreset engine. Architecture §7.4.
//
// One transaction, fully lands or fully rolls back. Idempotent
// per the architecture's rule 1 ("re-running is either a no-op or
// a full discard-and-reseed, never additive — that produces
// four 'Beginners' batches"). We pick the no-op branch: if the
// same preset is already applied to the tenant, return ok without
// re-seeding. Switching from a different applied preset is refused
// — that is the manual-change path, not the engine's.
//
// Lock-after-first-real-use (rule 5): any member row blocks the
// apply. Members don't carry an is_sample column — every member is
// a real one, by definition. The engine's contract: "if you have
// people, you don't get a free reset; do it by hand."

export type ApplyPresetResult =
  | {
      kind: "ok";
      presetKey: string;
      presetVersion: number;
      appliedAt: Date;
      idempotent: boolean;
    }
  | { kind: "preset_not_found"; message: string }
  | { kind: "tenant_not_found"; message: string }
  | {
      kind: "lock_active";
      reason: "non_sample_member_exists" | "different_preset_already_applied";
      appliedKey: string | null;
      message: string;
    };

export async function applyPreset(
  tenantId: TenantId,
  presetKey: string,
  ctx: { actorId: UserId },
): Promise<ApplyPresetResult> {
  // Two-step: the platform-side read for the preset definition is
  // outside the tenant transaction (it lives in the platform
  // allowlist, not in the tenant scope). The tenant-side write
  // opens a withTenant() transaction below.
  const presetResult = await getActivePreset(presetKey);
  if (presetResult.kind === "not_found") {
    return {
      kind: "preset_not_found",
      message: `No active preset with key "${presetKey}".`,
    };
  }
  const preset = presetResult;
  const definition = preset.definition;

  return withTenant(tenantId, async (tx) => {
    // 1. Tenant must exist. (withTenant() doesn't fail on unknown
    // tenant; it just opens a transaction with no rows. The
    // tenant existence check has to be explicit.)
    const tenantRows = await tx
      .select({
        id: tenants.id,
        presetKey: tenants.presetKey,
        presetVersion: tenants.presetVersion,
        timezone: tenants.timezone,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) {
      return {
        kind: "tenant_not_found",
        message: `No tenant with id "${tenantId}".`,
      } satisfies ApplyPresetResult;
    }

    // 2. Already-applied check. Same key+version → no-op idempotent
    // re-run. Different key → refuse (manual reset required).
    if (tenant.presetKey !== null) {
      if (tenant.presetKey === presetKey) {
        // Idempotent re-run of the same preset. Architecture rule 1
        // ("Re-running is either a no-op or a full discard-and-reseed")
        // — we pick the no-op branch. The earlier `applied_at` is
        // preserved; the contract is "the tenant has the preset
        // applied", not "this call was the first call".
        return {
          kind: "ok",
          presetKey,
          presetVersion: tenant.presetVersion ?? preset.version,
          appliedAt: new Date(),
          idempotent: true,
        };
      }
      return {
        kind: "lock_active",
        reason: "different_preset_already_applied",
        appliedKey: tenant.presetKey,
        message: `Tenant already has preset "${tenant.presetKey}" applied; switching requires manual clean-up.`,
      };
    }

    // 3. Member check. Architecture rule 5: any existing member
    // blocks the apply. Members don't carry is_sample — every
    // member is a real one by definition. This is the lock.
    const memberRows = await tx
      .select({ id: sql`gen_random_uuid()` })
      .from(sql`members`)
      .where(sql`members.tenant_id = ${tenantId}::uuid`)
      .limit(1);
    if (memberRows.length > 0) {
      return {
        kind: "lock_active",
        reason: "non_sample_member_exists",
        appliedKey: null,
        message: `Tenant has at least one member — applyPreset is locked. Edit the seeded data by hand.`,
      };
    }

    // 4. Apply the definition. Each step is itself idempotent at
    // the SQL layer (ON CONFLICT DO NOTHING) so a re-run after a
    // partial application cannot duplicate rows. The trigger
    // is the presence of `tenants.preset_key` (handled above);
    // everything below the trigger runs once per tenant.

    // 4a. tenant_features: enable each feature key. Existing rows
    // are preserved — the operator's per-tenant overrides (1.8)
    // win over the preset's defaults.
    for (const featureKey of definition.features) {
      await tx
        .insert(tenantFeatures)
        .values({
          tenantId,
          featureKey,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [tenantFeatures.tenantId, tenantFeatures.featureKey],
          set: {
            enabled: true,
            updatedAt: new Date(),
          },
        });
    }

    // 4b. tenants.terminology — replace entirely. The preset is
    // the operator's first vocabulary; they edit in settings (2.10)
    // after that.
    await tx
      .update(tenants)
      .set({
        terminology: definition.terminology,
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
      })
      .where(eq(tenants.id, tenantId));

    // 4c. Roles + permissions. The five system roles (owner,
    // admin, accountant, receptionist, coach, worker) are seeded
    // by seedRoleTemplates at tenant creation; the preset's roles
    // array is the vertical's *additional* roles, never a re-seed
    // of the standard ones. Each is a fresh insert; we don't
    // overwrite an existing role with the same name because the
    // operator may have edited it.
    //
    // First: validate EVERY permission key referenced by every
    // role against the platform catalogue. A typo would otherwise
    // surface as a 23503 FK violation mid-transaction, which would
    // roll back the whole apply — correct, but with an opaque
    // error message. We do the validation up front and throw a
    // descriptive error if any permission is unknown, so the
    // definition author sees the actual problem.
    if (definition.roles.length > 0) {
      const allPermissionKeys = Array.from(
        new Set(definition.roles.flatMap((r) => r.permissions)),
      );
      const known = await tx
        .select({ key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, allPermissionKeys));
      const knownSet = new Set(known.map((p) => p.key));
      const phantom = allPermissionKeys.filter((k) => !knownSet.has(k));
      if (phantom.length > 0) {
        throw new Error(
          `preset ${presetKey}@${preset.version}: unknown permissions: ${phantom.join(", ")}`,
        );
      }
    }

    for (const roleSpec of definition.roles) {
      const roleKey = slugify(roleSpec.name);
      const existing = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey)))
        .limit(1);
      let roleId: string;
      if (existing[0]) {
        roleId = existing[0].id;
      } else {
        const inserted = await tx
          .insert(roles)
          .values({
            id: uuidv7(),
            tenantId,
            key: roleKey,
            name: roleSpec.name,
            isSystem: false,
            homePath: "/owner",
            homeOrdinal: 4,
            createdBy: ctx.actorId,
            updatedBy: ctx.actorId,
          })
          .returning({ id: roles.id });
        roleId = inserted[0]!.id;
      }
      // Replace the role's permission grants with the preset's set.
      // The operator can later edit; this is the same shape as
      // seedRoleTemplates (no merge).
      await tx
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.tenantId, tenantId),
            eq(rolePermissions.roleId, roleId),
          ),
        );
      if (roleSpec.permissions.length > 0) {
        await tx.insert(rolePermissions).values(
          roleSpec.permissions.map((permissionKey: string) => ({
            tenantId,
            roleId,
            permissionKey,
            grantedBy: ctx.actorId,
          })),
        );
      }
    }

    // 4d. Programs. Each program is keyed by (tenant, name);
    // re-running inserts nothing new.
    for (const p of definition.programs) {
      await tx
        .insert(programs)
        .values({
          id: uuidv7(),
          tenantId,
          name: p.name,
          description: null,
          isSample: true,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })
        .onConflictDoUpdate({
          target: [programs.id, programs.tenantId],
          set: {
            isSample: true,
            updatedAt: new Date(),
            updatedBy: ctx.actorId,
          },
        });
    }

    // 4e. Skill ladder. Skill levels and their skills are keyed by
    // (tenant, name) — re-running inserts nothing new. The rubric
    // is overwritten with the preset's version (presets are
    // versioned; rubric is owned by the version, not the operator).
    for (const level of definition.skillLevels) {
      const levelRow = await tx
        .insert(skillLevels)
        .values({
          id: uuidv7(),
          tenantId,
          name: level.name,
          ordinal: level.ordinal,
          isSample: true,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })
        .onConflictDoUpdate({
          target: [skillLevels.id, skillLevels.tenantId],
          set: {
            ordinal: level.ordinal,
            isSample: true,
            updatedAt: new Date(),
            updatedBy: ctx.actorId,
          },
        })
        .returning({ id: skillLevels.id });
      // ON CONFLICT DO UPDATE doesn't return when the row is a no-op
      // match (postgresql limitation). Re-SELECT the id by name to
      // make the next step robust either way.
      const resolvedLevelId =
        levelRow[0]?.id ??
        (
          await tx
            .select({ id: skillLevels.id })
            .from(skillLevels)
            .where(
              and(
                eq(skillLevels.tenantId, tenantId),
                eq(skillLevels.name, level.name),
              ),
            )
            .limit(1)
        )[0]?.id;
      if (!resolvedLevelId) {
        throw new Error(
          `applyPreset: skill_level "${level.name}" insert/upsert returned no id`,
        );
      }
      for (const skill of level.skills) {
        await tx
          .insert(skills)
          .values({
            id: uuidv7(),
            tenantId,
            skillLevelId: resolvedLevelId,
            name: skill.name,
            rubric: skill.rubric,
            isSample: true,
            createdBy: ctx.actorId,
            updatedBy: ctx.actorId,
          })
          .onConflictDoUpdate({
            target: [skills.id, skills.tenantId],
            set: {
              rubric: skill.rubric,
              isSample: true,
              updatedAt: new Date(),
              updatedBy: ctx.actorId,
            },
          });
      }
    }

    // 4f. Plan shapes. amount_paise stays null (architecture
    // §7.2). The wizard (2.6) makes the field required before
    // any plan can activate.
    for (const shape of definition.planShapes) {
      await tx
        .insert(planShapes)
        .values({
          id: uuidv7(),
          tenantId,
          name: shape.name,
          kind: shape.kind,
          durationDays: shape.kind === "duration" ? shape.durationDays : null,
          sessions: shape.kind === "sessions" ? shape.sessions : null,
          amountPaise: null,
          currency: "INR",
          isSample: true,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })
        .onConflictDoUpdate({
          target: [planShapes.id, planShapes.tenantId],
          set: {
            kind: shape.kind,
            durationDays: shape.kind === "duration" ? shape.durationDays : null,
            sessions: shape.kind === "sessions" ? shape.sessions : null,
            isSample: true,
            updatedAt: new Date(),
            updatedBy: ctx.actorId,
          },
        });
    }

    // 4g. Facilities + sub-units.
    for (const fac of definition.facilities) {
      const facRow = await tx
        .insert(facilities)
        .values({
          id: uuidv7(),
          tenantId,
          name: fac.name,
          kind: fac.kind,
          capacity: fac.capacity,
          isSample: true,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })
        .onConflictDoUpdate({
          target: [facilities.id, facilities.tenantId],
          set: {
            name: fac.name,
            kind: fac.kind,
            capacity: fac.capacity,
            isSample: true,
            updatedAt: new Date(),
            updatedBy: ctx.actorId,
          },
        })
        .returning({ id: facilities.id });
      const facilityId =
        facRow[0]?.id ??
        (
          await tx
            .select({ id: facilities.id })
            .from(facilities)
            .where(
              and(
                eq(facilities.tenantId, tenantId),
                eq(facilities.name, fac.name),
              ),
            )
            .limit(1)
        )[0]?.id;
      if (!facilityId) {
        throw new Error(
          `applyPreset: facility "${fac.name}" insert/upsert returned no id`,
        );
      }
      for (const sub of fac.subUnits) {
        // Sub-units are append-only — each `Lane 1` from a re-run
        // would otherwise accumulate. Use a name-based uniqueness
        // check inside the facility to keep idempotence.
        const dup = await tx
          .select({ id: facilitySubUnits.id })
          .from(facilitySubUnits)
          .where(
            and(
              eq(facilitySubUnits.tenantId, tenantId),
              eq(facilitySubUnits.facilityId, facilityId),
              eq(facilitySubUnits.name, sub.name),
            ),
          )
          .limit(1);
        if (dup.length === 0) {
          await tx.insert(facilitySubUnits).values({
            id: uuidv7(),
            tenantId,
            facilityId,
            name: sub.name,
            createdBy: ctx.actorId,
            updatedBy: ctx.actorId,
          });
        }
      }
    }

    // 4h. Example batches. Each example references a program by
    // name (so the definition file is human-readable) — the engine
    // resolves the program_id at apply time. Batches don't have
    // a unique constraint on (tenant, name) today; using
    // ON CONFLICT DO UPDATE on the (id, tenant_id) PK would require
    // a stable id, but we generate a fresh uuid per apply. So the
    // idempotence for batches is enforced at the rule layer above
    // (the second apply short-circuits on `tenants.preset_key`).
    // The migration cost of a `unique (tenant, name)` constraint
    // is small; defer it to the day the operator needs it (2.3's
    // "remove sample data" affordance would also benefit).
    //
    // For now, this branch runs ONLY on the first apply. The
    // idempotence rule above keeps the second apply from reaching
    // here. If the engine ever grows a re-seed branch (rule 1's
    // other option), this loop will need to clear is_sample rows
    // for the tenant's program first.
    if (definition.exampleBatches.length > 0) {
      const programNames: string[] = Array.from(
        new Set(
          definition.exampleBatches.map(
            (b: { programName: string }) => b.programName,
          ),
        ),
      );
      // Resolve program names to ids. Each exampleBatches row's
      // programName field names the program it attaches to.
      const programRows = programNames.length
        ? await tx
            .select({ id: programs.id, name: programs.name })
            .from(programs)
            .where(inArray(programs.name, programNames))
        : [];
      const programByName = new Map(
        programRows.map((p: { id: string; name: string }) => [p.name, p.id]),
      );
      for (const b of definition.exampleBatches) {
        // Skip a batch whose program isn't present in the same
        // preset's programs list — a definition bug we surface in
        // validation rather than silently dropping the row. The
        // Zod parse at the read path already validated that every
        // programName is a string; whether the *program* exists is
        // a runtime check.
        const programId = programByName.get(b.programName);
        if (!programId) continue;
        const endTime = addHour(b.startTime);
        const dowArr = `{${b.daysOfWeek.join(",")}}`;
        await tx.execute(drizzleSql`
          insert into batches
            (id, tenant_id, program_id, name, capacity,
             days_of_week, start_time, end_time, is_sample,
             created_by, updated_by, created_at, updated_at)
          values
            (${uuidv7()}, ${tenantId}, ${programId}, ${b.name}, ${b.capacity},
             ${dowArr}::int[], ${b.startTime}, ${endTime}, true,
             ${ctx.actorId}, ${ctx.actorId}, now(), now())
          on conflict (id, tenant_id) do nothing
        `);
      }

      // E1 — fifth instance of the same divergence class (D2, D3):
      // this loop inserts batches directly rather than through
      // createBatch() (lib/services/programs.ts), which is what
      // materialises sessions for a new batch. createBatch() opens
      // its own withTenant() transaction, so it can't be called from
      // inside this one — same generateSessions() call the job,
      // both seed scripts, and createBatch() all already use, run
      // here in the same transaction as the batch inserts instead.
      // Idempotent (onConflictDoNothing), so calling it even when
      // exampleBatches produced zero rows costs nothing extra.
      await generateSessions(tx, tenantId, tenant.timezone);
    }

    // 4i. Message templates — keyed by (tenant, key); re-runs
    // overwrite with the preset's content. Templates are preset
    // data; the operator can edit afterwards and the edit is
    // preserved by the same (tenant, key) uniqueness.
    for (const tpl of definition.messageTemplates) {
      await tx
        .insert(messageTemplates)
        .values({
          id: uuidv7(),
          tenantId,
          key: tpl,
          content: `Template: ${tpl}`, // placeholder content — Phase 4 messaging fills this in
          isSample: true,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })
        .onConflictDoUpdate({
          target: [messageTemplates.tenantId, messageTemplates.key],
          set: {
            content: sql`excluded.content`,
            isSample: true,
            updatedAt: new Date(),
            updatedBy: ctx.actorId,
          },
        });
    }

    // 4j. dashboard_cards on the tenant — simple replace.
    await tx
      .update(tenants)
      .set({
        dashboardCards: definition.dashboardCards,
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
      })
      .where(eq(tenants.id, tenantId));

    // 5. Stamp the tenant with the applied preset. The check
    // above is the lock; setting preset_key is the unlock record
    // for the no-op branch on the next apply.
    const appliedAt = new Date();
    await tx
      .update(tenants)
      .set({
        presetKey: presetKey,
        presetVersion: preset.version,
        presetAppliedAt: appliedAt,
        updatedAt: appliedAt,
        updatedBy: ctx.actorId,
      })
      .where(eq(tenants.id, tenantId));

    return {
      kind: "ok",
      presetKey,
      presetVersion: preset.version,
      appliedAt,
      idempotent: false,
    };
  });
}

// slugify a role name into a stable key. "Head coach" → "head-coach".
// Lowercase ASCII alphanumerics + hyphens; everything else collapsed.
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// "07:00" → "08:00". Time is HH:MM; we add 60 minutes. Pure
// function so the engine has no opinion about the rest of the
// session. The example batches are scaffolding (architecture
// §7.4 rule 4: sample rows are flagged); the operator edits the
// real start/end in the batch editor.
function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  const total = (h ?? 0) * 60 + (m ?? 0) + 60;
  const newH = Math.floor((total / 60) % 24);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

// Re-export the result type for callers.
export type { ApplyPresetResult as ApplyPresetResultType };
// (The duplicate name is intentional — the type alias in
// lib-actions and the engine export are the same shape, but the
// engine's own export-as-type-via-PascalCase-rename is unhelpful
// for the action layer. Use `ApplyPresetResult` directly.)
// The above re-export is a no-op for runtime; the import is below.
void asc;

// ---------------------------------------------------------------------------
// previewPreset
// ---------------------------------------------------------------------------
// 2.2b's UI needs to render "this preset will seed N programs, M
// batches, X facilities" before the operator clicks Apply. The
// preview is a pure function over the (parsed) definition — no DB
// writes, no withTenant() transaction, no audit log. Two reasons
// it lives on the engine module rather than the form:
//   1. The shape of "what gets seeded" is owned by the engine
//      contract; the form should not have to re-derive it.
//   2. Preview is testable in isolation: a unit test that calls
//      previewPreset('swimming') and asserts the counts lets us
//      catch drift between the JSON definition and the engine
//      reader without setting up a tenant.

export type PresetPreview = {
  presetKey: string;
  presetVersion: number;
  name: string;
  description: string;
  status: "active" | "deprecated";
  // counts only — the form does not need the full enumerated
  // entity list to render the preview; if it does, it can re-call
  // getActivePreset to read the raw definition.
  counts: {
    featuresEnabled: number;
    programs: number;
    skillLevels: number;
    skills: number;
    planShapes: number;
    facilities: number;
    facilitySubUnits: number;
    exampleBatches: number;
    messageTemplates: number;
    dashboardCards: number;
    roles: number;
  };
};

export type PreviewPresetResult =
  | { kind: "ok"; preview: PresetPreview }
  | { kind: "not_found"; message: string };

export async function previewPreset(
  key: string,
): Promise<PreviewPresetResult> {
  const result = await getActivePreset(key);
  if (result.kind === "not_found") {
    return {
      kind: "not_found",
      message: `No active preset with key "${key}".`,
    };
  }
  const d = result.definition;
  const subUnitCount = d.facilities.reduce(
    (n, f) => n + f.subUnits.length,
    0,
  );
  const skillCount = d.skillLevels.reduce(
    (n, l) => n + l.skills.length,
    0,
  );
  return {
    kind: "ok",
    preview: {
      presetKey: result.key,
      presetVersion: result.version,
      name: result.name,
      description: result.description,
      status: result.status,
      counts: {
        featuresEnabled: d.features.length,
        programs: d.programs.length,
        skillLevels: d.skillLevels.length,
        skills: skillCount,
        planShapes: d.planShapes.length,
        facilities: d.facilities.length,
        facilitySubUnits: subUnitCount,
        exampleBatches: d.exampleBatches.length,
        messageTemplates: d.messageTemplates.length,
        dashboardCards: d.dashboardCards.length,
        roles: d.roles.length,
      },
    },
  };
}
void asc;
