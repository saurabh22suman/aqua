import type { ReactNode } from "react";
import Link from "next/link";

// Phase 1 (mobile UX plan v2) — DESIGN.md §3: "Empty state — built with
// the list, never after. Every list has one. Every empty state has a
// verb CTA." The audit found seven ad-hoc empties (some with no CTA,
// some with no body); this is the one shape they collapse into.

export type EmptyStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: EmptyStateAction;
};

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12" data-testid="empty-state">
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-deck text-ink-3">
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-medium">{title}</p>
      {body ? <p className="mt-2 text-[13px] text-ink-3">{body}</p> : null}
      {action?.href ? (
        <Link
          href={action.href}
          className="mt-5 inline-flex items-center justify-center rounded-pill px-5 py-3 text-[14px] font-semibold text-paper bg-[var(--accent)] transition-colors duration-150"
        >
          {action.label}
        </Link>
      ) : action?.onClick ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 rounded-pill px-5 py-3 text-[14px] font-semibold text-paper bg-[var(--accent)] transition-colors duration-150"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
