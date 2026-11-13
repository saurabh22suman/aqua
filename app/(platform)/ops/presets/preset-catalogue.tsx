"use client";

import { PresetCard } from "./preset-card";
import { OpsEmptyState } from "@/components/ops/ops-primitives";

// Phase 2.2b — client island for the catalogue page. Receives the
// server-rendered preview list and renders one card per preset.
// Composition: per design, one dominant element per screen — the
// card's "Open preview" button is the only saturated colour on it.
// Count badges are below; description prose is supporting. The
// empty state is a separate path that surfaces the `pnpm db:seed`
// command as its verb CTA (per the audit's "every list has a
// designed empty state with a verb CTA" reminder).

export type PresetEntry = {
  preset: {
    key: string;
    version: number;
    name: string;
    description: string;
    status: "active" | "deprecated";
  };
  result:
    | {
        kind: "ok";
        preview: {
          presetKey: string;
          presetVersion: number;
          name: string;
          description: string;
          status: "active" | "deprecated";
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
      }
    | { kind: "not_found"; message: string };
};

export function PresetCatalogue({
  entries,
}: {
  entries: PresetEntry[];
}) {
  if (entries.length === 0) {
    return (
      <OpsEmptyState
        className="mt-8"
        title="No presets yet"
        body={
          <>
            The catalogue is empty. Run the seed to populate it on a fresh
            database.
          </>
        }
      />
    );
  }
  return (
    <div className="mt-6 space-y-4">
      {entries.map((entry) => (
        <PresetCard key={entry.preset.key} entry={entry} />
      ))}
    </div>
  );
}
