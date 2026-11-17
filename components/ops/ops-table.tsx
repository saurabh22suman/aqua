import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

// Ops redesign (28 October 2026) — the Ops table, toolbar and list.
//
// The approved concept's table is dense and keeps its own sideways
// scroll inside a LABELLED region, so a column set that cannot fit
// scrolls inside the table instead of squeezing names into four-line
// wraps and never moves the page sideways.
//
// The labelled region is focusable and named, so a keyboard user can
// reach the horizontal scrollbar — an unnamed overflow container is
// unreachable with the keyboard alone.

/** A dense table inside its own labelled, keyboard-reachable scroller. */
export function OpsTable({
  label,
  children,
  className,
}: {
  /** The accessible name of the scroll region, e.g. "Tenants". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-card border border-line bg-paper",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The table itself: dense, with the concept's header rhythm. */
export function OpsTableGrid({ children }: { children: ReactNode }) {
  return (
    <table className="w-full min-w-[860px] border-collapse text-[14px]">
      {children}
    </table>
  );
}

/** A header cell. `numeric` right-aligns a figure column. */
export function OpsTableHead({
  children,
  numeric,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line px-4 py-3 text-[11px] font-medium uppercase tracking-[0.10em] text-ink-3",
        numeric && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

/** A body cell. `numeric` right-aligns a figure column. */
export function OpsTableCell({
  children,
  numeric,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-line px-4 py-3 align-top text-ink-2 last:[&]:border-b-0",
        numeric && "text-right tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * The filter toolbar: a GET form that re-runs the page's query.
 *
 * Every filter is a real named control, so the form's own query string
 * IS the filter state — the operator can copy the URL, and the Back
 * button returns to the previous filter set.
 */
export function OpsToolbar({
  children,
  actions,
  layout = "grid",
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  /**
   * "grid" stacks the filters in a grid and the actions on their own
   * row beneath them. "inline" puts the action BESIDE the filters on
   * one row — for a toolbar with a single filter, where a full-width
   * filter and a far-away action leave a blank band between them.
   */
  layout?: "grid" | "inline";
}) {
  if (layout === "inline") {
    return (
      <form
        method="get"
        className={cn(
          "flex flex-wrap items-end gap-3 rounded-card border border-line bg-paper p-4",
          className,
        )}
      >
        {children}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </form>
    );
  }
  return (
    <form
      method="get"
      className={cn(
        "grid grid-cols-1 gap-3 rounded-card border border-line bg-paper p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end",
        className,
      )}
    >
      {children}
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 lg:col-span-4 lg:justify-end">
          {actions}
        </div>
      ) : null}
    </form>
  );
}

/** A divided list: the card the concept uses for a list of records. */
export function OpsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul
      className={cn(
        "overflow-hidden rounded-card border border-line bg-paper",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** One row of an OpsList. */
export function OpsListRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0",
        className,
      )}
    >
      {children}
    </li>
  );
}
