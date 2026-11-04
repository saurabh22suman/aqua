import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";

// Ops redesign (28 October 2026) — the Ops display primitives.
//
// The approved concept gives every console page the same frame: an
// eyebrow, one heading, a lede, the page's own action, then sections
// of cards. These components are that frame, so a route composes its
// own content instead of re-inventing the container, the section
// heading, the card, the empty state or the status pill.
//
// Everything here is a TOKEN surface: no new colour, no new radius,
// no new spacing scale. The concept's palette is the product's
// palette.
//
// The Ops console is desktop-first but responsive, so every primitive
// here collapses to one column on a phone rather than hiding content.

/** The page frame. The concept caps the content column at 1080px. */
export function OpsPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1080px]", className)}>
      {children}
    </div>
  );
}

/**
 * The page header: eyebrow, one heading, the lede, and the page's own
 * action. The action slot holds ONE primary action; a second action is
 * a quiet one.
 */
export function OpsPageHeader({
  eyebrow,
  title,
  lede,
  actions,
  meta,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  /** A short freshness/scope note on the right, e.g. "Last refreshed …". */
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight text-marine">
          {title}
        </h1>
        {lede ? (
          <p className="mt-2 max-w-[76ch] text-[15px] text-ink-2">{lede}</p>
        ) : null}
      </div>
      {/* The action/meta slot is rendered ONLY when it carries
          something. An EMPTY flex item still WRAPS: on the new-tenant
          page the wide heading group pushed the empty slot onto a
          second row, and that row's gap was added to the gap between
          the heading and the form (the root measured 48px where one
          32px gap belongs). When the slot IS used, the wrapper and
          all of its content are unchanged. */}
      {actions || meta ? (
        <div
          data-testid="ops-page-header-actions"
          className="flex flex-none flex-col items-end gap-2"
        >
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {actions}
            </div>
          ) : null}
          {meta ? <p className="text-[12px] text-ink-3">{meta}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A section: the small-caps title, its note, and its body.
 *
 * It renders a DIV, not a <section>: a section element is a landmark
 * only when it carries an accessible name, and an unnamed <section>
 * would only add noise to a landmark list — while making it harder for
 * a page to compose (a route that already owns a named <section>
 * cannot nest another one).
 */
export function OpsSection({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      {title ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 max-w-[76ch] text-[13px] text-ink-2">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex-none">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A card: the paper surface with the hairline and the card radius. */
export function OpsCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-card border border-line bg-paper", className)}>
      {children}
    </div>
  );
}

/** A card whose content reaches its own edges (a divided list, a table). */
export function OpsCardFlush({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-line bg-paper",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The tone vocabulary for the informational panels. */
export type OpsPanelTone = "info" | "warn" | "error" | "pending";

const PANEL_CLASS: Record<OpsPanelTone, string> = {
  info: "border-[color-mix(in_srgb,var(--color-water)_28%,transparent)] bg-[var(--color-water-soft)] text-[var(--color-water)]",
  warn: "border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  error:
    "border-[color-mix(in_srgb,var(--color-late)_30%,transparent)] bg-[var(--color-late-soft)] text-[var(--color-late)]",
  pending: "border-line bg-deck text-ink-2",
};

/**
 * An informational panel. The tone is a SURFACE; the title carries the
 * meaning in words, so colour is never the only cue.
 */
export function OpsPanel({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: OpsPanelTone;
  title?: string;
  children: ReactNode;
  className?: string;
  /** The ARIA role, e.g. "alert" for an error a screen reader announces. */
  role?: "alert" | "status" | "note";
}) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-ctl border px-4 py-3 text-[13px]",
        PANEL_CLASS[tone],
        className,
      )}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={cn(title && "mt-1")}>{children}</div>
    </div>
  );
}

/**
 * The empty state: built WITH the list, never after it. It always
 * says what is missing and what to do next.
 */
export function OpsEmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      data-testid="ops-empty-state"
      className={cn(
        "rounded-card border border-line bg-paper px-5 py-10 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {body ? <p className="mt-2 text-[13px] text-ink-3">{body}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-flex min-h-12 items-center justify-center rounded-ctl bg-[var(--action-surface)] px-4 py-2.5 text-[16px] font-medium text-[var(--action-foreground)] transition-colors duration-150 hover:bg-[var(--action-surface-hover)]"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** A quiet link that reads as a link, not as a button. */
export function OpsTextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:no-underline"
    >
      {children}
    </Link>
  );
}
