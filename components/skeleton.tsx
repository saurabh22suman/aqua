import type { ReactNode } from "react";

// Phase 1.5–1.7 cleanup — skeleton primitive. DESIGN.md §3 says
// "skeletons, never spinners" because users are on flaky poolside
// 4G where a spinner reads as broken; a placeholder block matches
// the layout that's about to arrive.
//
// These components take width/height as numbers of Tailwind units
// (default 4px each), so a 4-column row of `<Skeleton w={32} h={4} />`
// matches the spacing of the eventual content rather than guessing
// from CSS. `rounded` keeps the placeholder consistent with the
// card radii used elsewhere in the design system.

function tone(extra?: string): string {
  return `bg-deck animate-pulse${extra ? ` ${extra}` : ""}`;
}

export function Skeleton({
  w = 32,
  h = 4,
  rounded = "rounded",
  className,
}: {
  w?: number;
  h?: number;
  rounded?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`${tone(className)} ${rounded}`}
      style={{ width: `${w * 0.25}rem`, height: `${h * 0.25}rem` }}
    />
  );
}

// A row of N skeletons. Use for "title + subtext" placeholders.
export function SkeletonLine({
  count = 3,
  width,
  className,
}: {
  count?: number;
  width?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          w={width ?? [48, 32, 24][Math.min(i, 2)] ?? 32}
          h={3}
          className="mb-2 last:mb-0"
        />
      ))}
    </div>
  );
}

// A row shaped like the page's primary table.
export function SkeletonTable({
  rows = 4,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  const widths = [40, 16, 12, 12, 12, 12, 16, 12];
  return (
    <div
      className={`rounded-card bg-paper border border-line overflow-hidden ${className ?? ""}`}
    >
      <div className="px-4 py-3 border-b border-line">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} w={widths[i] ?? 16} h={3} />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className={`px-4 py-3 ${r > 0 ? "border-t border-line" : ""}`}
        >
          <div className="flex gap-4">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                w={widths[c] ?? 16}
                h={4}
                className="my-0.5"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// A row shaped like the page's primary stat tile.
export function SkeletonStat({
  label = true,
  value,
}: {
  label?: boolean;
  value?: number;
}) {
  return (
    <div className="rounded-card bg-paper border border-line px-4 py-3">
      {label ? (
        <Skeleton w={20} h={3} className="mb-3" />
      ) : null}
      <Skeleton w={value ?? 16} h={7} rounded="rounded" />
    </div>
  );
}

// A row-shaped card skeleton — title + body text placeholders.
export function SkeletonCard({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card bg-paper border border-line px-5 py-5 ${className ?? ""}`}
    >
      {children ?? (
        <>
          <Skeleton w={28} h={4} className="mb-3" />
          <SkeletonLine count={3} />
        </>
      )}
    </div>
  );
}
