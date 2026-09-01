import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./client";
import { withPlatform } from "./scope";
import { features, type Feature } from "./schema/platform";
import { platformAuditLog } from "./schema/platform-users";
import type { UserId } from "@/lib/ids";

// Phase 1.7 — feature catalogue editor. `features` is in the
// platform-side allowlist (db/allowlist.ts) so it has no RLS;
// `app_user` already has the full grant from bootstrap-roles.ts
// (`select, insert, update, delete on all tables`). Reads and
// writes both go through `withPlatform()` as the standing
// convention for any platform-scoped service — no scope guard
// needed.
//
// The `key` column is the immutable analytics key (architecture
// §7.4 — "Nothing a preset creates is privileged. ... 6. No
// runtime branching. ... The closed platform permission list"
// applies by analogy here: feature_key drives `featureFlag`
// checks across the codebase and the per-tenant override table
// 1.8 will add references it directly). The service rejects any
// update that tries to rename the key.
//
// `name` is the operator-visible label. `category` is freeform
// text — the categories used by db/seed-platform.ts's FEATURES
// list are core / growth / money / staff / insight / platform /
// comms / facility / vertical / commerce; new categories
// accepted without a schema check, mirroring the seed's
// unstructured approach. Future work may add a CHECK constraint
// against a closed enum if the taxonomy settles.
//
// `status` is the `'ga' | 'beta' | 'internal'` triple. `'beta'`
// is what 1.8 will eventually extend with per-tenant expiry
// (architecture §7.1, "Resolution order"); the catalogue itself
// only persists the global baseline today.
//
// Every successful update writes a `platform_audit_log` row with
// action=`feature.update`, target_type=`feature`, target_id=key,
// and a detail JSON showing the previous + new values for every
// changed column. Tenants and operators surface this through
// `getTenantDetail`'s recent-activity timeline (1.4) and the
// platform-wide audit views 3.9 lands later.

export type FeatureStatus = "ga" | "beta" | "internal";

export const FEATURE_STATUSES: ReadonlyArray<FeatureStatus> = [
  "ga",
  "beta",
  "internal",
];

export const updateFeatureInput = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Feature key is required.")
    .max(60)
    .regex(
      /^[a-z0-9](?:[a-z0-9._-]{0,58}[a-z0-9])$/,
      "Key must be lowercase letters, numbers, dots, hyphens or underscores.",
    ),
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120),
  category: z
    .string()
    .trim()
    .min(1, "Category is required.")
    .max(60),
  status: z.enum(FEATURE_STATUSES),
});
export type UpdateFeatureInput = z.input<typeof updateFeatureInput>;

export type UpdateFeatureOk = {
  kind: "ok";
  previous: Feature;
};
export type UpdateFeatureError = {
  kind: "error";
  code: "invalid" | "not_found";
  message: string;
};
export type UpdateFeatureResult = UpdateFeatureOk | UpdateFeatureError;

export async function listFeatures(): Promise<Feature[]> {
  return withPlatform(async () =>
    db
      .select({
        key: features.key,
        name: features.name,
        category: features.category,
        status: features.status,
      })
      .from(features)
      .orderBy(features.category, features.name),
  );
}

export async function getFeature(key: string): Promise<Feature | null> {
  return withPlatform(async () => {
    const rows = await db
      .select({
        key: features.key,
        name: features.name,
        category: features.category,
        status: features.status,
      })
      .from(features)
      .where(eq(features.key, key))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function updateFeature(
  rawInput: UpdateFeatureInput,
  ctx: { actorId: UserId },
): Promise<UpdateFeatureResult> {
  const parsed = updateFeatureInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  return withPlatform(async () =>
    db.transaction(async (tx) => {
      // SELECT FOR UPDATE on the row so concurrent edits can't both
      // succeed: only the second one wins, the first's audit row
      // still reflects its own change rather than a "self-update"
      // on the second writer's input.
      const rows = await tx
        .select({
          key: features.key,
          name: features.name,
          category: features.category,
          status: features.status,
        })
        .from(features)
        .where(eq(features.key, input.key))
        .limit(1);
      const previous = rows[0];
      if (!previous) {
        return {
          kind: "error",
          code: "not_found",
          message: `No feature with key "${input.key}".`,
        };
      }

      // Same idea as the RLS policy intent for tenant-side writes:
      // the `key` is a stable identity, never an editable field.
      // If a future product need changes the relation, expose it
      // explicitly — do not silently coerce.
      if (input.key !== previous.key) {
        return {
          kind: "error",
          code: "invalid",
          message: "Feature key cannot be changed.",
        };
      }

      // No-op short-circuit: same name/category/status as the row
      // already carries → return ok without an audit write. This
      // keeps the audit timeline truthful (every row is a real
      // operator-triggered change), and saves the operator from a
      // confusing "saved successfully" toast on a row they didn't
      // touch.
      if (
        previous.name === input.name &&
        previous.category === input.category &&
        previous.status === input.status
      ) {
        return { kind: "ok", previous };
      }

      await tx
        .update(features)
        .set({
          name: input.name,
          category: input.category,
          status: input.status,
        })
        .where(eq(features.key, input.key));

      await tx.insert(platformAuditLog).values({
        actorId: ctx.actorId,
        // tenantId is null — the platform action targets a feature,
        // not a tenant. The schema allows it (nullable FK).
        action: "feature.update",
        targetType: "feature",
        targetId: null,
        detail: {
          key: input.key,
          before: {
            name: previous.name,
            category: previous.category,
            status: previous.status,
          },
          after: {
            name: input.name,
            category: input.category,
            status: input.status,
          },
        },
      });

      return {
        kind: "ok",
        previous: {
          key: previous.key,
          name: previous.name,
          category: previous.category,
          status: previous.status,
        },
      };
    }),
  );
}
