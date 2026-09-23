"use client";

import { useState } from "react";
import { recordAssessmentAction } from "@/lib/actions/assessments";
import { EmptyState } from "@/components/ui/EmptyState";
import { BackLink } from "@/components/ui/BackLink";
import type { MemberProgress } from "@/lib/services/skill-progress";

// V-10 — the one-tap assess board. Each node is one row; the four band
// buttons are the tap targets (44px per button, full-width grid at
// 390×844). Tapping a band records the assessment immediately, so the
// register target — three swimmers assessed in under a minute — is
// three taps plus navigation.
//
// Staff-side only; the parent link renders none of this.

const BAND_BUTTON =
  "h-11 rounded-ctl border text-[14px] font-medium transition-colors duration-150";

export function AssessmentBoard({
  memberId,
  progress,
  canAssess,
  back,
}: {
  memberId: string;
  progress: MemberProgress;
  canAssess: boolean;
  back: { href: string; label: string };
}) {
  const [bands, setBands] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const framework of progress.frameworks) {
      for (const node of framework.nodes) {
        if (node.band !== null) initial[node.id] = node.band;
      }
    }
    return initial;
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const frameworks = progress.frameworks.filter((f) => f.nodes.length > 0);
  if (frameworks.length === 0) {
    return (
      <div className="mt-4 rounded-card border border-line bg-paper">
        <EmptyState
          title="No skill ladder yet"
          body="Ask the owner to set the ladder up under Settings → Skills, then come back and tap a band."
        />
      </div>
    );
  }

  async function record(nodeId: string, nodeName: string, band: number) {
    if (!canAssess || saving) return;
    setSaving(nodeId);
    setMessage(null);
    const note = notes[nodeId]?.trim();
    const result = await recordAssessmentAction({
      memberId,
      nodeId,
      band,
      notes: note ? note : undefined,
    });
    if (result.ok) {
      setBands((prev) => ({ ...prev, [nodeId]: band }));
      setNotes((prev) => ({ ...prev, [nodeId]: "" }));
      setMessage(`${nodeName}: band ${band} saved.`);
    } else {
      setMessage(result.error);
    }
    setSaving(null);
  }

  return (
    <div>
      <BackLink href={back.href} label={back.label} />
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Assess {progress.memberName}
      </h1>
      <p className="mt-1 text-[12.5px] text-ink-3">
        {progress.memberCode} · tap a band to save it. One tap, one
        assessment.
      </p>

      {!canAssess ? (
        <div className="mt-4 rounded-card border border-line bg-paper px-4 py-3">
          <p className="text-[13px] text-ink-2">
            You can see this ladder but not record bands. Ask the owner
            if you should be marking assessments.
          </p>
        </div>
      ) : null}

      {message ? (
        <p
          role="status"
          data-testid="assess-message"
          className="mt-3 rounded-ctl border border-line bg-water-soft px-3 py-2 text-[13px] text-ink-2"
        >
          {message}
        </p>
      ) : null}

      {frameworks.map((framework) => {
        const levels = framework.nodes.filter((n) => n.parentId === null);
        const childrenOf = (levelId: string) =>
          framework.nodes.filter((n) => n.parentId === levelId);
        return (
          <section key={framework.id} className="mt-4">
            <h2 className="font-display text-[14px] font-semibold">
              {framework.name}
            </h2>
            {levels.map((level) => {
              const skills = childrenOf(level.id);
              const rows = skills.length > 0 ? skills : [level];
              return (
                <div
                  key={level.id}
                  className="mt-2 rounded-card border border-line bg-paper p-3.5"
                >
                  <p className="text-[13px] font-medium text-ink-2">
                    {level.name}
                  </p>
                  <ul className="mt-2 space-y-3">
                    {rows.map((node) => (
                      <li key={node.id}>
                        <p className="text-[14px] font-medium">{node.name}</p>
                        {node.rubric["4"] ? (
                          <p className="mt-0.5 text-[11.5px] text-ink-3">
                            Band 4: {node.rubric["4"]}
                          </p>
                        ) : null}
                        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                          {[1, 2, 3, 4].map((band) => {
                            const active = bands[node.id] === band;
                            return (
                              <button
                                key={band}
                                type="button"
                                disabled={!canAssess || saving === node.id}
                                aria-pressed={active}
                                aria-label={`${node.name} band ${band}`}
                                data-testid={`band-${band}-${node.id}`}
                                onClick={() => void record(node.id, node.name, band)}
                                className={`${BAND_BUTTON} ${
                                  active
                                    ? "border-water bg-water text-paper"
                                    : "border-line bg-paper text-ink-2"
                                } disabled:opacity-60`}
                              >
                                {band}
                              </button>
                            );
                          })}
                        </div>
                        <input
                          type="text"
                          value={notes[node.id] ?? ""}
                          onChange={(e) =>
                            setNotes((prev) => ({
                              ...prev,
                              [node.id]: e.target.value,
                            }))
                          }
                          maxLength={500}
                          placeholder="Optional note for the next tap"
                          aria-label={`Note for ${node.name}`}
                          className="mt-1.5 w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none"
                        />
                        {saving === node.id ? (
                          <p className="mt-1 text-[11.5px] text-ink-3">Saving…</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
