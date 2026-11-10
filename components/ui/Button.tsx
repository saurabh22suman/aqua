import type { ButtonHTMLAttributes } from "react";

// 2026-09-13 UI/UX audit §7.2 — there was no shared Button primitive.
// On one Owner member-detail screen five buttons sharing the same
// radius measured five different heights (33/36/38/44/44px), three of
// them below DESIGN.md §2's hard 44×44px floor. This is the enforced
// scale.
//
// Owner redesign (27 October 2026) — the approved control contract:
// the shared system now has ONE standard control:
//
//   "Standard action buttons, text fields, selects, date and time
//    pickers share a 48px height, 10px radius, 16px control text and
//    consistent horizontal padding. Long actions may wrap and grow; do
//    not clip them to meet a numeric height. Compact table/tertiary
//    controls retain at least 44px effective targets."
//
//   - `sm` is the COMPACT control (a table row action, a tertiary
//     control): 44px, the accessibility floor, and the only variant
//     that may sit below the standard height.
//   - `md` and `lg` are the STANDARD control: 48px
//     (`--control-height-md`), 16px control text, the 10px control
//     radius and one horizontal padding (16px, `--control-padding-x`).
//   - The DEFAULT is `md`. A caller that says nothing gets the
//     STANDARD control, so an ordinary header, form or toolbar action
//     is never 44px beside a 48px input. A genuinely compact table or
//     tertiary action opts in to `size="sm"` explicitly — the booking
//     desk's per-row actions do exactly that.
//   - A long label WRAPS and the button grows. Nothing here sets
//     `whitespace-nowrap`, `truncate` or `overflow-hidden`, so an
//     action is never clipped to keep a numeric height.
//
// The tints follow the approved rule: a solid theme colour for the one
// primary action, a slightly stronger theme tint for a secondary
// action, a neutral surface for a tertiary one, and the reserved `late`
// token for a destructive action. Destructive/error/success always
// carry a word or an icon as well, so colour is never the only cue.
//
// `destructive` is a real variant backed by the `late` token, for
// actions that are hard to reverse (Ops "Mark churned"). `primary`
// remains the single accent action; everything else is secondary or
// ghost (DESIGN.md §3 "one primary action per screen").

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive";

export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent-strong)] text-white hover:bg-[var(--action-surface-hover)]",
  secondary:
    "border border-[var(--control-border)] bg-[var(--control-surface-action)] text-[var(--accent-ink)] hover:bg-[var(--control-surface-action-hover)] hover:border-[var(--control-border-hover)]",
  ghost: "bg-transparent text-ink-2 hover:bg-deck",
  destructive: "bg-late text-white hover:opacity-90",
};

// sm = 44px (the DESIGN.md §2 floor for a compact table/tertiary
// control, met exactly); md/lg = 48px, the standard control height.
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3.5 py-2 text-[16px]",
  md: "min-h-12 px-4 py-2.5 text-[16px]",
  lg: "min-h-12 px-4 py-3 text-[16px]",
};

export function buttonClasses({
  variant = "secondary",
  size = "md",
  pill = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  className?: string;
} = {}): string {
  return [
    "inline-flex items-center justify-center gap-1.5 font-medium",
    pill ? "rounded-pill" : "rounded-ctl",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    "transition-colors duration-150 disabled:opacity-50",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  pill = false,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // A stable hook for the shared control contract: the browser
      // geometry probe and any lane's own check can find a SHARED
      // button without guessing at its classes.
      data-control="button"
      className={buttonClasses({ variant, size, pill, className })}
      {...rest}
    />
  );
}
