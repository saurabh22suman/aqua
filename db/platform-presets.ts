import { desc, eq, and } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { presets } from "./schema/platform";
import {
  presetDefinitionSchema,
  type PresetDefinition,
} from "./preset-definitions";

// Phase 2.1 — read-side helpers for the platform preset catalogue.
//
// The applyPreset engine (Phase 2.2 / F-20) is what writes tenant
// state from a preset. This module is the read path the picker UI
// (2.6) will call when listing the catalogue and previewing what a
// given preset would seed.
//
// Why two functions instead of one: a list-with-details call would
// parse every preset's full definition jsonb on every render.
// 2.1 keeps that work on the detail path; the list call hands
// callers the metadata only.

export type PresetListEntry = {
  key: string;
  version: number;
  name: string;
  description: string;
  status: "active" | "deprecated";
};

export async function listPresets(): Promise<PresetListEntry[]> {
  // `presets` is in the platform-tables allowlist (db/allowlist.ts)
  // — RLS-exempt by design. The platform-admin scope is unnecessary
  // for reads; withPlatform() is the standing convention for any
  // platform-side read.
  return withPlatform(async () => {
    const rows = await db
      .select({
        key: presets.key,
        version: presets.version,
        name: presets.name,
        description: presets.description,
        status: presets.status,
      })
      .from(presets)
      .orderBy(presets.key);
    return rows.map((r) => ({
      key: r.key,
      version: r.version,
      name: r.name,
      description: r.description,
      status: r.status as "active" | "deprecated",
    }));
  });
}

export type GetPresetResult =
  | {
      kind: "ok";
      key: string;
      version: number;
      name: string;
      description: string;
      status: "active" | "deprecated";
      definition: PresetDefinition;
    }
  | { kind: "not_found" };

// Returns the highest-version active row for `key`. The future
// 2.2 engine will look up this same row inside its transaction
// to apply the definition; pinning the version here means the
// 2.2 picker UI can preview exactly the shape 2.2 will apply.
export async function getActivePreset(
  key: string,
): Promise<GetPresetResult> {
  return withPlatform(async () => {
    const rows = await db
      .select({
        key: presets.key,
        version: presets.version,
        name: presets.name,
        description: presets.description,
        status: presets.status,
        definition: presets.definition,
      })
      .from(presets)
      .where(and(eq(presets.key, key), eq(presets.status, "active")))
      .orderBy(desc(presets.version))
      .limit(1);

    const row = rows[0];
    if (!row) return { kind: "not_found" };

    // Zod parse the JSON at the boundary. A mis-shaped definition
    // would otherwise be `unknown` everywhere — the apply engine
    // in 2.2 would crash on first reference. Failing here makes
    // the data error visible at the read path.
    const parsed = presetDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) {
      throw new Error(
        `preset ${row.key}@${row.version}: invalid definition: ${parsed.error.message}`,
      );
    }
    return {
      kind: "ok",
      key: row.key,
      version: row.version,
      name: row.name,
      description: row.description,
      status: row.status as "active" | "deprecated",
      definition: parsed.data,
    };
  });
}
