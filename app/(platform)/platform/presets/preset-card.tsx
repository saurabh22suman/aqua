"use client";

import Link from "next/link";
import { useState } from "react";
import type { PresetEntry } from "./preset-catalogue";

// Phase 2.2b — per-preset card. One dominant element: the
// "Open preview" link — saturated colour, on a single row. The
// description and the count badges are secondary content. The
// collapsed details panel shows the count breakdown; that's the
// preview pane the user asked for.
//
// The "Apply to a tenant" interaction lives at
// /platform/presets/[key] (the dedicated route the link points to),
// not on the catalogue card itself. The card's primary action is
// the preview; the apply is the next step in the same flow.

type CountKey =
  | "featuresEnabled"
  | "programs"
  | "skillLevels"
  | "skills"
  | "planShapes"
  | "facilities"
  | "facilitySubUnits"
  | "exampleBatches"
  | "messageTemplates"
  | "dashboardCards"
  | "roles";

const COUNT_LABELS: Array<{ key: CountKey; label: string }> = [
  { key: "featuresEnabled", label: "features" },
  { key: "programs", label: "programs" },
  { key: "skillLevels", label: "skill levels" },
  { key: "skills", label: "skills" },
  { key: "planShapes", label: "plan shapes" },
  { key: "facilities", label: "facilities" },
  { key: "facilitySubUnits", label: "sub-units" },
  { key: "exampleBatches", label: "example batches" },
  { key: "messageTemplates", label: "message templates" },
  { key: "dashboardCards", label: "dashboard cards" },
  { key: "roles", label: "vertical roles" },
];

export function PresetCard({ entry }: { entry: PresetEntry }) {
  const [open, setOpen] = useState(false);
  // The catalogue itself does not apply; the apply form is on the
  // detail page. The card's primary action is the "Open preview"
  // link, which navigates to that detail page.

  return (
    <article className="rounded-card bg-paper border border-line p-5">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-display text-[18px] font-semibold text-ink">
            {entry.preset.name}
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3 font-mono">
            v{entry.preset.version} · {entry.preset.status}
          </p>
        </div>
        <Link
          href={`/platform/presets/${entry.preset.key}`}
          className="rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 transition-colors duration-150"
        >
          Open preview
        </Link>
      </header>
      <p className="mt-3 text-[13px] text-ink-2 leading-relaxed">
        {entry.preset.description}
      </p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 text-[12px] font-medium text-ink-2 hover:text-ink"
        aria-expanded={open}
      >
        {open ? "Hide counts" : "Show counts"}
      </button>
      {open && entry.result.kind === "ok" ? (
        (() => {
          const counts = entry.result.preview.counts;
          return (
            <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {COUNT_LABELS.map((item) => (
                <li
                  key={item.key}
                  className="rounded-ctl bg-deck px-3 py-2 text-[12px]"
                >
                  <span className="font-mono text-ink font-semibold">
                    {counts[item.key]}
                  </span>
                  <span className="ml-1.5 text-ink-3">{item.label}</span>
                </li>
              ))}
            </ul>
          );
        })()
      ) : null}
    </article>
  );
}
