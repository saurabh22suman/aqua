import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./cn";

// UI foundation — Pagination.
//
// The pager for a long list. It states where the reader is ("Page 2 of
// 7") instead of only offering arrows, and the arrows disable at the
// ends instead of wrapping around silently.

export type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Accessible name of the navigation landmark. */
  label?: string;
  className?: string;
};

export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = "Pagination",
  className,
}: PaginationProps) {
  const atStart = page <= 1;
  const atEnd = page >= pageCount;
  return (
    <nav
      aria-label={label}
      className={cn("flex items-center justify-between gap-3", className)}
    >
      <button
        type="button"
        aria-label="Previous page"
        disabled={atStart}
        onClick={() => onPageChange(page - 1)}
        className="inline-flex min-h-11 items-center gap-1 rounded-ctl border border-line bg-paper px-3 text-[13px] font-medium text-ink-2 motion-fast transition-colors hover:bg-deck disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        Previous
      </button>
      <span className="text-[13px] text-ink-2">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        aria-label="Next page"
        disabled={atEnd}
        onClick={() => onPageChange(page + 1)}
        className="inline-flex min-h-11 items-center gap-1 rounded-ctl border border-line bg-paper px-3 text-[13px] font-medium text-ink-2 motion-fast transition-colors hover:bg-deck disabled:cursor-not-allowed disabled:opacity-50"
      >
        Next
        <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </nav>
  );
}
