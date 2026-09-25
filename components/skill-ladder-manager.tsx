"use client";

import { useState } from "react";
import {
  updateSkillLevelAction,
  updateSkillNodeAction,
} from "@/lib/actions/skill-ladder";
import type {
  SkillLadderNodeRow,
  SkillLadderRow,
} from "@/lib/services/skill-ladder";
import { EmptyState } from "@/components/ui/EmptyState";

// V-09 — the ladder editor. Lists the generic framework the bridge
// populated and edits level names, skill names and the four-band
// rubric. Every save is one audited mutation; the list below the
// inputs is the source of truth (no optimistic state).

const INPUT =
  "w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";
const BAND_LABELS: Array<{ key: string; label: string }> = [
  { key: "1", label: "Band 1" },
  { key: "2", label: "Band 2" },
  { key: "3", label: "Band 3" },
  { key: "4", label: "Band 4" },
];

function LevelCard({ node }: { node: SkillLadderNodeRow }) {
  const [name, setName] = useState(node.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-3 rounded-card border border-line bg-paper p-3.5">
      <label className="block">
        <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-ink-3">
          Level
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className={INPUT}
          data-testid={`level-name-${node.id}`}
        />
      </label>
      <button
        type="button"
        disabled={busy || name.trim().length === 0}
        onClick={() => {
          setBusy(true);
          setMessage(null);
          void (async () => {
            const result = await updateSkillLevelAction({
              nodeId: node.id,
              name,
            });
            setMessage(result.ok ? "Saved." : result.error);
            setBusy(false);
          })();
        }}
        className="mt-2 min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save level"}
      </button>
      {message ? (
        <p role="status" className="mt-1.5 text-[12px] text-ink-3">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function SkillCard({ node }: { node: SkillLadderNodeRow }) {
  const [name, setName] = useState(node.name);
  const [rubric, setRubric] = useState<Record<string, string>>(() => ({
    "1": node.rubric["1"] ?? "",
    "2": node.rubric["2"] ?? "",
    "3": node.rubric["3"] ?? "",
    "4": node.rubric["4"] ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <li className="border-t border-line py-3 first:border-0 first:pt-0">
      <label className="block">
        <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-ink-3">
          Skill
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className={INPUT}
          data-testid={`skill-name-${node.id}`}
        />
      </label>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12.5px] text-ink-3">
          Rubric — what each band means
        </summary>
        <div className="mt-2 space-y-2">
          {BAND_LABELS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="mb-0.5 block text-[11px] text-ink-3">
                {label}
              </span>
              <textarea
                value={rubric[key] ?? ""}
                onChange={(e) =>
                  setRubric((prev) => ({ ...prev, [key]: e.target.value }))
                }
                rows={2}
                maxLength={2000}
                className={INPUT}
                data-testid={`skill-rubric-${key}-${node.id}`}
              />
            </label>
          ))}
        </div>
      </details>
      <button
        type="button"
        disabled={busy || name.trim().length === 0}
        onClick={() => {
          setBusy(true);
          setMessage(null);
          void (async () => {
            const result = await updateSkillNodeAction({
              nodeId: node.id,
              name,
              rubric,
            });
            setMessage(result.ok ? "Saved." : result.error);
            setBusy(false);
          })();
        }}
        className="mt-2 min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save skill"}
      </button>
      {message ? (
        <p role="status" className="mt-1.5 text-[12px] text-ink-3">
          {message}
        </p>
      ) : null}
    </li>
  );
}

export function SkillLadderManager({ ladders }: { ladders: SkillLadderRow[] }) {
  if (ladders.length === 0) {
    return (
      <div className="rounded-card border border-line bg-paper">
        <EmptyState
          title="No skill ladder yet"
          body="Apply the swimming preset (or add levels by hand) and the ladder appears here, editable."
        />
      </div>
    );
  }

  return (
    <div>
      {ladders.map((ladder) => {
        const levels = ladder.nodes.filter((n) => n.parentId === null);
        const skillsOf = (levelId: string) =>
          ladder.nodes
            .filter((n) => n.parentId === levelId)
            .sort((a, b) => a.ordinal - b.ordinal);
        return (
          <section key={ladder.id} className="mt-5">
            <h2 className="font-display text-[15px] font-semibold">
              {ladder.name}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Activity type: {ladder.activityTypeKey}
            </p>
            {levels.map((level) => (
              <div key={level.id}>
                <LevelCard node={level} />
                <ul className="mt-1 rounded-card border border-line bg-paper px-3.5">
                  {skillsOf(level.id).map((skill) => (
                    <SkillCard key={skill.id} node={skill} />
                  ))}
                  {skillsOf(level.id).length === 0 ? (
                    <li className="py-3 text-[12px] text-ink-3">
                      No skills under this level yet.
                    </li>
                  ) : null}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
