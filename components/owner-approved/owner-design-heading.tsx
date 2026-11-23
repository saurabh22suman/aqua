import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Shared Owner page heading; callers supply only already-authorized actions. */
export function OwnerDesignHeading({ title, purpose, eyebrow, action, className, ...rest }: {
  title: ReactNode;
  purpose?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div data-owner-design-heading className={cn("mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 lg:mb-6", className)} {...rest}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">{eyebrow}</p> : null}
        <h1 className="font-display text-[27px] font-semibold leading-[1.15] tracking-[-0.8px] text-ink lg:text-[31px]">{title}</h1>
        {purpose ? <p className="mt-1 max-w-[65ch] text-[13px] leading-relaxed text-ink-3">{purpose}</p> : null}
      </div>
      {action ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
