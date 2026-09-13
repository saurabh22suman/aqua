import type { ReactNode } from "react";

// 2026-09-13 UI/UX audit §7.1 — the Members list was the only surface
// that colour-coded lifecycle state. Enquiries (owner + reception,
// one shared board) and the Ops tenant list rendered every stage in
// the same ink-2 grey. This generalises the Members list's proven
// pattern into the shared primitive DESIGN.md §3 already describes
// ("Status pill … always carries a word or icon, never colour alone").
//
// Tone vocabulary is deliberately small and maps 1:1 to the semantic
// tokens in DESIGN.md §1.1 plus the neutral pair for terminal states
// that carry no urgency (left, churned). `--accent` never appears
// here — accent is actions only (DESIGN.md §1.2).

export type StatusTone = "good" | "warn" | "late" | "neutral" | "water";

const TONE_CLASS: Record<StatusTone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  late: "bg-late-soft text-late",
  // F-4 (2026-09-13 Indian-user UX audit): `bg-deck text-ink-2` was
  // invisible wherever the badge sat directly on the deck-coloured
  // page background (Enquiries' divided list) — the exact bug the
  // shared primitive was extracted to fix. Paper + hairline keeps
  // the pill legible on both white cards and the deck page.
  neutral: "bg-paper text-ink-2 border border-line",
  water: "bg-water-soft text-water",
};

// Members list lifecycle (formerly inline in members-board.tsx).
// trial/paused need attention (warn), lapsed is a problem state
// (late), left is terminal and quiet (neutral).
export const MEMBER_STATUS_TONE: Record<string, StatusTone> = {
  trial: "warn",
  active: "good",
  paused: "warn",
  lapsed: "late",
  left: "neutral",
};

// Enquiry pipeline (owner + reception). "New" is the attention state;
// converted is a paid-equivalent win (good); lost is the negative
// terminal (late); the middle stages are progress (water, the same
// token the lane strip uses for progress).
export const ENQUIRY_STAGE_TONE: Record<string, StatusTone> = {
  new: "warn",
  contacted: "neutral",
  trial_scheduled: "water",
  trial_completed: "water",
  converted: "good",
  lost: "late",
};

// Platform tenant lifecycle. Active is healthy (good), trial is
// time-boxed (warn), suspended is blocked (late), churned is terminal
// and quiet (neutral). Before the audit all four were identical.
export const TENANT_STATUS_TONE: Record<string, StatusTone> = {
  trial: "warn",
  active: "good",
  suspended: "late",
  churned: "neutral",
};

export function StatusBadge({
  tone,
  children,
  className = "",
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 rounded-pill px-3 py-1 text-[11px] font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
