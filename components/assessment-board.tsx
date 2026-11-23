"use client";

import { useState } from "react";
import { getMemberProgressAction, recordAssessmentAction } from "@/lib/actions/assessments";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
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
  const [bands, setBands] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {};
    for (const framework of progress.frameworks) {
      for (const node of framework.nodes) {
        if (node.band !== null) initial[node.id] = node.band;
      }
    }
    return initial;
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ nodeId: string; text: string; unknown?: boolean } | null>(null);

  const frameworks = progress.frameworks.filter((f) => f.nodes.length > 0);
  if (frameworks.length === 0) {
    return (
      <div className="mt-4">
        <BackLink href={back.href} label={back.label} />
        <div className="rounded-card border border-line bg-paper">
          <EmptyState title="No skill ladder yet" body="Ask the owner to set the ladder up under Settings → Skills, then come back and tap a band." />
        </div>
      </div>
    );
  }

  async function record(nodeId: string, nodeName: string, band: number) {
    if (!canAssess || saving || feedback?.unknown) return;
    setSaving(nodeId);
    setFeedback(null);
    try {
      const note = notes[nodeId]?.trim();
      const result = await recordAssessmentAction({ memberId, nodeId, band, notes: note || undefined });
      if (result.ok) {
        setBands((prev) => ({ ...prev, [nodeId]: band }));
        setNotes((prev) => ({ ...prev, [nodeId]: "" }));
        setFeedback({ nodeId, text: `${nodeName}: band ${band} saved.` });
      } else {
        setFeedback({ nodeId, text: result.error });
      }
    } catch {
      setFeedback({ nodeId, unknown: true, text: "Could not confirm the save. Check the saved assessment before recording again." });
    } finally {
      setSaving(null);
    }
  }

  async function checkSavedAssessment(nodeId: string) {
    if (saving || !feedback?.unknown || feedback.nodeId !== nodeId) return;
    setSaving(nodeId);
    try {
      const latest = await getMemberProgressAction(memberId);
      const skill = latest?.frameworks.flatMap((framework) => framework.nodes).find((node) => node.id === nodeId);
      if (!skill) {
        setFeedback({ nodeId, unknown: true, text: "This skill is unavailable. Open the member’s progress again to review it." });
        return;
      }
      setBands((previous) => ({ ...previous, [nodeId]: skill.band }));
      setFeedback({
        nodeId,
        text: skill.band === null ? "The latest record has no saved band for this skill." : `Latest saved band: ${skill.band}. Review it before recording again.`,
      });
    } catch {
      setFeedback({ nodeId, unknown: true, text: "Could not check the saved assessment. Try checking again." });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <BackLink href={back.href} label={back.label} />
      <h1 className="mt-1 text-[22px] font-semibold leading-tight text-ink">
        Assess {progress.memberName}
      </h1>
      <p className="mt-1 text-[12.5px] text-ink-3">
        {progress.memberCode}{canAssess ? " · Tap a band to record an assessment." : ""}
      </p>
      <Link href="/coach/curriculum" className="inline-flex min-h-11 items-center text-[13px] text-ink-2 underline underline-offset-2">
        View curriculum
      </Link>

      {!canAssess ? (
        <div className="mt-4 rounded-card border border-line bg-paper px-4 py-3">
          <p className="text-[13px] text-ink-2">
            You can see this ladder but not record bands. Ask the owner
            if you should be marking assessments.
          </p>
        </div>
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
                      <li key={node.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-[14px] font-medium">{node.name}</p>
                          <span className="text-[12px] text-ink-2">{bands[node.id] == null ? "Awaiting assessment" : `Saved band ${bands[node.id]}`}</span>
                        </div>
                        <details className="mt-1 text-[12px] text-ink-2">
                          <summary className="min-h-11 cursor-pointer content-center">View band criteria</summary>
                          <ul className="space-y-1 pb-2">
                            {[1, 2, 3, 4].map((band) => (
                              <li key={band}>Band {band}: {node.rubric[String(band)] || "Not specified"}</li>
                            ))}
                          </ul>
                        </details>
                        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                          {[1, 2, 3, 4].map((band) => {
                            const active = bands[node.id] === band;
                            return (
                              <button
                                key={band}
                                type="button"
                                disabled={!canAssess || saving !== null || Boolean(feedback?.unknown)}
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
                          readOnly={!canAssess || saving === node.id}
                          placeholder="Optional note for the next tap"
                          aria-label={`Note for ${node.name}`}
                          className="mt-1.5 w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none"
                        />
                        {saving === node.id ? (
                          <p role="status" className="mt-1 text-[12px] text-ink-2">
                            {feedback?.unknown ? "Checking saved assessment…" : "Saving…"}
                          </p>
                        ) : null}
                        {feedback?.nodeId === node.id ? (
                          <div className="mt-2 rounded-ctl border border-line bg-deck p-2.5">
                            <p role="status" data-testid="assess-message" className="text-[13px] text-ink">{feedback.text}</p>
                            {feedback.unknown ? (
                              <Button type="button" size="sm" variant="secondary" disabled={saving !== null}
                                className="mt-1" onClick={() => void checkSavedAssessment(node.id)}>
                                Check saved assessment
                              </Button>
                            ) : null}
                          </div>
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
