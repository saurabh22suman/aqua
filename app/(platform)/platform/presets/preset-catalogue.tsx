"use client";

import { PresetCard } from "./preset-card";

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
      <div className="mt-8 rounded-card bg-paper border border-line px-5 py-12 text-center">
        <p className="text-[15px] font-medium text-ink">No presets yet</p>
        <p className="mt-2 text-[13px] text-ink-3">
          The catalogue is empty. Run the seed to populate it on a
          fresh database.
        </p>
        <code className="mt-4 inline-block rounded-ctl bg-deck px-3 py-1 text-[12px] font-mono text-ink-2">
          pnpm db:seed
        </code>
      </div>
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
