import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

// Owner OpenPen — the shared page heading rhythm.
//
// The reference opens every page with a 22px display title, a 13px muted
// purpose line and one action slot. One primitive keeps every owner route
// on that rhythm instead of each page hand-rolling a 19/24/28px heading.
// It carries no data, no permission and no icon: the caller passes the
// already-authorized action.
export function PageHeader({
  title,
  purpose,
  eyebrow,
  action,
  className,
  ...rest
}: {
  title: ReactNode;
  purpose?: ReactNode;
  /** A small context line above the title (for example the real date). */
  eyebrow?: ReactNode;
  /** The one contextual action slot. */
  action?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
      {...rest}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 font-display text-[22px] font-semibold leading-[1.25] tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {purpose ? (
          <p className="mt-1.5 max-w-[65ch] text-[13px] leading-relaxed text-ink-3">
            {purpose}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
    </div>
  );
}

// The reference's 16px section heading, with the same optional trailing
// slot as the existing SectionHeader. New owner pages use this; the
// existing SectionHeader primitive now shares the 16px scale.
export function SectionHeading({
  title,
  subtitle,
  trailing,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[16px] font-semibold leading-[1.4] text-ink">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{subtitle}</p>
        ) : null}
      </div>
      {trailing ? <div className="flex-none">{trailing}</div> : null}
    </div>
  );
}
