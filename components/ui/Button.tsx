import type { ButtonHTMLAttributes } from "react";

// 2026-09-13 UI/UX audit §7.2 — there was no shared Button primitive.
// On one Owner member-detail screen five buttons sharing the same
// radius measured five different heights (33/36/38/44/44px), three of
// them below DESIGN.md §2's hard 44×44px floor. This is the enforced
// scale; `sm` is already 44px so no call site can drift below the
// floor while remaining on the primitive.
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
  primary: "bg-[var(--accent)] text-white hover:opacity-90",
  secondary: "border border-line bg-paper text-ink-2 hover:bg-deck",
  ghost: "bg-deck text-ink-2 hover:bg-paper",
  destructive: "bg-late text-white hover:opacity-90",
};

// sm = 44px (the DESIGN.md floor, met exactly), md/lg = 48px for
// primary or trailing actions where a little more weight is useful.
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3.5 py-2 text-[13px]",
  md: "min-h-12 px-5 py-3 text-[14px]",
  lg: "min-h-12 px-5 py-3.5 text-[15px]",
};

export function buttonClasses({
  variant = "secondary",
  size = "sm",
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
  size = "sm",
  pill = false,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, pill, className })}
      {...rest}
    />
  );
}
