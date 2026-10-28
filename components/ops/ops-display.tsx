import type { ReactNode } from "react";
import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { cn } from "@/components/ui/cn";

// Ops redesign (28 October 2026) — the Ops data-display primitives.
//
// The pieces that show a VALUE: a key/value row, a figure tile, a
// status pill, the read-only notice and the write gate. They live
// apart from the page frame (components/ops/ops-primitives.tsx) so
// each module stays readable.

/** One key/value row: the label on the left, the value on the right. */
export function OpsKeyValue({
  label,
  value,
  mono,
  href,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  href?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span
        className={cn(
          "text-[14px] font-medium text-ink",
          mono && "font-mono text-[13px]",
        )}
      >
        {href ? (
          <Link href={href} className="hover:underline underline-offset-2">
            {value}
          </Link>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

/**
 * The summary tile's surface. The tokens are the OWNER's own
 * (DESIGN.md §1.4b): a calm mint for an active platform context, a
 * restrained butter for a trial context, powder blue for general task
 * information, soft red ONLY for a real problem, and the neutral
 * paper surface when a figure is calm.
 *
 * The surface GROUPS information; it never carries the meaning. The
 * label, the number and the explanatory line carry the meaning, and a
 * status icon carries the state.
 */
export type OpsKpiSurface = "paper" | "money" | "butter" | "info" | "late";

/** The icon chip's ink: the reserved status tokens, or neutral. */
export type OpsKpiChipTone =
  | "good"
  | "late"
  | "warn"
  | "water"
  | "marine"
  | "neutral";

const KPI_SURFACE_CLASS: Record<OpsKpiSurface, string> = {
  paper: "bg-paper border border-line",
  money: "bg-tile-money",
  butter: "bg-tile-butter",
  info: "bg-tile-info",
  late: "bg-late-soft",
};

const KPI_CHIP_CLASS: Record<OpsKpiChipTone, string> = {
  good: "bg-good-soft text-good",
  late: "bg-late-soft text-late",
  warn: "bg-warn-soft text-warn",
  water: "bg-water-soft text-water",
  marine: "bg-marine text-paper",
  neutral: "bg-deck text-ink-2",
};

/**
 * The figure tile: a label, a number, an optional icon chip and an
 * optional explanatory note.
 *
 * The chip is the OWNER's shape: 32px, the 10px chip radius, an
 * 18px icon and an 8px gap to the label. It is decorative — the words
 * carry the meaning — so it is hidden from assistive technology.
 *
 * The note is a DIV, not a paragraph: the note is usually the delta
 * line, which is itself a paragraph, and a paragraph may not contain a
 * paragraph (invalid HTML, and a hydration mismatch on the populated
 * Overview).
 */
export function OpsKpi({
  label,
  value,
  note,
  surface = "paper",
  icon,
  chipTone = "neutral",
  valueTone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** The pastel surface; "paper" is the calm default. */
  surface?: OpsKpiSurface;
  /** A decorative icon node, drawn in the 32px chip. */
  icon?: ReactNode;
  /** The chip's ink. */
  chipTone?: OpsKpiChipTone;
  /** The FIGURE's ink, when the figure itself is a real problem. */
  valueTone?: "late";
}) {
  return (
    <div
      data-testid="ops-kpi"
      data-kpi-label={label}
      className={cn("rounded-card px-4 py-4", KPI_SURFACE_CLASS[surface])}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span
            aria-hidden="true"
            data-testid="ops-kpi-icon"
            className={cn(
              "grid h-8 w-8 flex-none place-items-center rounded-[10px]",
              KPI_CHIP_CLASS[chipTone],
            )}
          >
            {icon}
          </span>
        ) : null}
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {label}
        </p>
      </div>
      <p
        className={cn(
          "mt-1 font-display text-[28px] font-semibold leading-tight tabular-nums",
          valueTone === "late" ? "text-late" : "text-marine",
        )}
      >
        {value}
      </p>
      {note ? <div className="mt-1 text-[12px] text-ink-3">{note}</div> : null}
    </div>
  );
}

/** A status pill. It always carries its word, never colour alone. */
export function OpsStatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StatusBadge tone={tone} className={className}>
      {children}
    </StatusBadge>
  );
}

/**
 * The read-only notice. A viewer sees it on every screen that can
 * write, so the limit is stated before the control is reached.
 */
export function OpsReadOnlyNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      data-testid="ops-read-only-note"
      className={cn(
        "rounded-ctl border border-[var(--surface-attention-border)] bg-[var(--surface-attention)] px-4 py-3 text-[13px] text-ink-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The write gate.
 *
 * The server already refuses a viewer's mutation — that is the
 * enforcement, and it does not move. This is the console's half: a
 * viewer is shown the state and the reason it cannot change it, never
 * a live-looking control that silently fails on submit.
 *
 * `canWrite` is resolved on the SERVER from the session role and
 * passed down as a plain boolean. It is a presentation decision, not
 * an authorization: a forged client value changes nothing, because the
 * action re-checks the session.
 */
export function OpsWriteGate({
  canWrite,
  children,
  note,
}: {
  canWrite: boolean;
  children: ReactNode;
  note?: ReactNode;
}) {
  if (canWrite) return <>{children}</>;
  return (
    <OpsReadOnlyNote>
      {note ?? (
        <>Read-only: this account can browse, not change, platform data.</>
      )}
    </OpsReadOnlyNote>
  );
}
