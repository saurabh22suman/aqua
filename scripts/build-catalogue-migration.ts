// scripts/build-catalogue-migration.ts
//
// One-shot helper for regenerating
// db/migrations/<timestamp>_reference_catalogue.sql from the TS
// catalogue source. The TS source is the single source of truth;
// this script just emits SQL so the catalogue is correct after a
// fresh `pnpm db:deploy` without `pnpm db:seed`.
//
// Use:
//   1. Edit db/seed-platform.ts (PERMISSIONS, FEATURES, PRESETS) or
//      db/config-definitions.ts (CONFIG_KEYS).
//   2. tsx scripts/build-catalogue-migration.ts
//      > db/migrations/<timestamp>_reference_catalogue.sql
//      or > /tmp/out.sql
//   3. Inspect, commit.
//
// Do NOT hand-edit the migration. The header comment on the generated
// file says so; this script exists so the TS→SQL path is mechanical.
//
// policy_versions is inline in seedPlatformCatalogue; the hard-coded
// array below tracks it. When the privacy notice text changes, edit
// it in BOTH places (or move the source of truth to a TS module
// imported by both).

import { PERMISSIONS, FEATURES, PRESETS } from "../db/seed-platform";
import { CONFIG_KEYS } from "../db/config-definitions";

const POLICY_VERSIONS: ReadonlyArray<{ version: string; content: string }> = [
  {
    version: "2026.1",
    content:
      "Placeholder consent notice — replace with the real DPDP-compliant privacy notice before go-live.",
  },
];

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

const out: string[] = [];

out.push("-- 20260918000000_reference_catalogue");
out.push("--");
out.push("-- Sibling commit's reference catalogue — permissions, features,");
out.push("-- plan_features, plans, presets, config_keys, policy_versions —");
out.push("-- so a fresh `pnpm db:deploy` lands a correct database without");
out.push("-- `pnpm db:seed`. See scripts/build-catalogue-migration.ts for");
out.push("-- regeneration; source of truth is db/seed-platform.ts and");
out.push("-- db/config-definitions.ts.");
out.push("--");
out.push("-- AUTO-GENERATED — do not edit by hand.");
out.push("");

out.push("-- features");
for (const f of FEATURES) {
  out.push(
    `insert into features (key, name, category, status) values ('${esc(f.key)}', '${esc(f.name)}', '${esc(f.category)}', '${f.status}') on conflict (key) do nothing;`,
  );
}
out.push("");

out.push("-- permissions");
for (const p of PERMISSIONS) {
  out.push(
    `insert into permissions (key, module, description) values ('${esc(p.key)}', '${esc(p.module)}', '${esc(p.description)}') on conflict (key) do nothing;`,
  );
}
out.push("");

out.push("-- plans (the one Standard plan)");
out.push(
  `insert into plans (id, key, name, status, price_paise, currency, is_default, sort_order)`,
);
out.push(
  `  values ('00000000-0000-0000-0000-000000000001', 'standard', 'Standard', 'active', null, 'INR', true, 0)`,
);
out.push(`  on conflict (key) do nothing;`);
out.push("");

out.push("-- plan_features: every ga feature on the standard plan, empty limits");
for (const f of FEATURES.filter((f) => f.status === "ga")) {
  out.push(
    `insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', '${esc(f.key)}', '{}'::jsonb) on conflict do nothing;`,
  );
}
out.push("");

out.push("-- presets (v1 catalogue)");
for (const preset of PRESETS) {
  out.push(
    `insert into presets (key, version, name, description, definition, status) values ('${esc(preset.key)}', ${preset.version}, '${esc(preset.name)}', '${esc(preset.description)}', '${esc(JSON.stringify(preset.definition))}'::jsonb, '${preset.status}') on conflict (key, version) do nothing;`,
  );
}
out.push("");

out.push("-- config_keys (O-04 catalogue)");
for (const [key, definition] of Object.entries(CONFIG_KEYS)) {
  out.push(
    `insert into config_keys (key, value_schema, default_value, visibility, risk, description) values ('${esc(key)}', '${esc(JSON.stringify(definition.jsonSchema))}'::jsonb, '${esc(JSON.stringify(definition.defaultValue))}'::jsonb, '${definition.visibility}', '${definition.risk}', '${esc(definition.description)}') on conflict (key) do nothing;`,
  );
}
out.push("");

out.push("-- policy_versions");
for (const pv of POLICY_VERSIONS) {
  out.push(
    `insert into policy_versions (version, content) values ('${esc(pv.version)}', '${esc(pv.content)}') on conflict (version) do nothing;`,
  );
}

process.stdout.write(out.join("\n") + "\n");
