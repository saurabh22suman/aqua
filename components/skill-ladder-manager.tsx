"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
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
import {
  SkillFramework,
  type SkillSelection,
} from "@/components/skill-ladder-framework";

// V-09 — the ladder editor. Lists the generic framework the bridge
// populated and edits level names, skill names and the four-band
// rubric. Every save is one audited mutation; the list below the
// inputs is the source of truth (no optimistic state).

const BAND_LABELS: Array<{ key: string; label: string }> = [
  { key: "1", label: "Band 1" },
  { key: "2", label: "Band 2" },
  { key: "3", label: "Band 3" },
  { key: "4", label: "Band 4" },
];

function LevelCard({ node, canEdit }: { node: SkillLadderNodeRow; canEdit: boolean }) {
  const [name, setName] = useState(node.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-3 rounded-card border border-line bg-paper p-3.5">
      <label className="block">
        <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-ink-3">
          Level
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          readOnly={!canEdit}
          data-testid={`level-name-${node.id}`}
        />
      </label>
      {canEdit ? (
        <Button
            variant="primary"
            size="md"
            className="mt-2"
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
          >
          {busy ? "Saving…" : "Save level"}
        </Button>
      ) : (
        <p className="mt-2 text-[12px] text-ink-3">
          Read only. Curriculum editing is delegated to the academy’s
          designated curriculum lead.
        </p>
      )}
      {message ? (
        <p
        role={message === "Saved." ? "status" : "alert"}
        className="mt-1.5 text-[12px] text-ink-3"
      >
        {message}
      </p>
      ) : null}
    </div>
  );
}

function SkillCard({ node, canEdit }: { node: SkillLadderNodeRow; canEdit: boolean }) {
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
    <div className="border-t border-line py-3 first:border-0 first:pt-0">
      <label className="block">
        <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-ink-3">
          Skill
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          readOnly={!canEdit}
          data-testid={`skill-name-${node.id}`}
        />
      </label>
      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-[12.5px] text-ink-3">
          Rubric — what each band means
        </summary>
        <div className="mt-2 space-y-2">
          {BAND_LABELS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="mb-0.5 block text-[11px] text-ink-3">
                {label}
              </span>
              <Textarea
                value={rubric[key] ?? ""}
                onChange={(e) =>
                  setRubric((prev) => ({ ...prev, [key]: e.target.value }))
                }
                rows={2}
                maxLength={2000}
                readOnly={!canEdit}
                data-testid={`skill-rubric-${key}-${node.id}`}
              />
            </label>
          ))}
        </div>
      </details>
      {canEdit ? (
        <Button
            variant="primary"
            size="md"
            className="mt-2"
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
          >
          {busy ? "Saving…" : "Save skill"}
        </Button>
      ) : null}
      {message ? (
        <p
          role={message === "Saved." ? "status" : "alert"}
          className="mt-1.5 text-[12px] text-ink-3"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

type Selection = SkillSelection;

function firstSelection(ladders: SkillLadderRow[]): Selection | null {
  const levels = ladders.flatMap((ladder) =>
    ladder.nodes.filter((node) => node.parentId === null),
  );
  const skills = ladders.flatMap((ladder) =>
    ladder.nodes
      .filter((node) => node.parentId !== null)
      .sort((a, b) => a.ordinal - b.ordinal),
  );
  if (skills[0]) return { nodeId: skills[0].id, kind: "skill" };
  if (levels[0]) return { nodeId: levels[0].id, kind: "level" };
  return null;
}

export function SkillLadderManager({
  ladders,
  canEdit,
}: {
  ladders: SkillLadderRow[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Selection | null>(() =>
    firstSelection(ladders),
  );
  const levels = ladders.flatMap((ladder) =>
    ladder.nodes.filter((node) => node.parentId === null).map((node) => ({ ladder, node })),
  );
  const skills = ladders.flatMap((ladder) =>
    ladder.nodes
      .filter((node) => node.parentId !== null)
      .map((node) => ({ ladder, node })),
  );
  const effective =
    selected && (levels.some((item) => item.node.id === selected.nodeId) ||
      skills.some((item) => item.node.id === selected.nodeId))
      ? selected
      : firstSelection(ladders);
  const selectedName =
    [...levels, ...skills].find((item) => item.node.id === effective?.nodeId)?.node.name ?? "";

  if (ladders.length === 0) {
    return (
      <div className="rounded-card border border-line bg-paper">
        <EmptyState
          title="No skill ladder yet"
          body={
            canEdit
              ? "Apply the swimming preset (or add levels by hand) and the ladder appears here, editable."
              : "Ask a curriculum lead to apply the swimming preset or add levels; the ladder will appear here. A curriculum lead can add or edit levels."
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5 lg:items-start">
      <SkillFramework
        ladders={ladders}
        selected={effective}
        onSelect={setSelected}
        canEdit={canEdit}
      />

      <section className="min-w-0 lg:col-span-3" aria-label="Selected framework detail">
        <h2 className="font-display text-[16px] font-semibold">
          Selected {effective?.kind === "level" ? "level" : "skill"}{" "}
          <span className="font-sans text-[13px] font-normal text-ink-3">
            · {selectedName}
          </span>
        </h2>
        <div className="mt-3 space-y-3">
          {levels.map(({ node }) => (
            <div
              key={`level-${node.id}`}
              data-testid={`level-editor-${node.id}`}
              hidden={effective?.kind !== "level" || effective?.nodeId !== node.id}
            >
              <LevelCard node={node} canEdit={canEdit} />
            </div>
          ))}
          {skills.map(({ node }) => (
            <div
              key={`skill-${node.id}`}
              data-testid={`skill-editor-${node.id}`}
              hidden={effective?.kind !== "skill" || effective?.nodeId !== node.id}
            >
              <SkillCard node={node} canEdit={canEdit} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
