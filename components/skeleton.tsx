import type { ReactNode } from "react";

// Dimensions use Tailwind spacing units. A preferred width shrinks with its
// container, including inside flex rows and narrow grid tracks.

export function Skeleton({
  w = 32,
  h = 4,
  rounded = "rounded",
  className,
}: {
  w?: number | "full";
  h?: number;
  rounded?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-skeleton
      className={`min-w-0 max-w-full bg-line motion-safe:animate-pulse motion-safe:[animation-iteration-count:2] ${rounded} ${className ?? ""}`}
      style={{ width: w === "full" ? "100%" : `${w * 0.25}rem`, height: `${h * 0.25}rem` }}
    />
  );
}

export function SkeletonStatus({ children }: { children: string }) {
  return <p role="status" className="sr-only">{children}</p>;
}

export function SkeletonList({ className }: { className?: string }) {
  return (
    <ul aria-hidden="true" className={`divide-y divide-line rounded-card border border-line bg-paper px-4 ${className ?? ""}`}>
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-3 py-3.5">
          <div className="min-w-0 flex-1">
            <Skeleton w={34} h={4} />
            <Skeleton w={46} h={3} className="mt-2" />
          </div>
          <Skeleton w={13} h={5} rounded="rounded-pill" className="shrink-0" />
        </li>
      ))}
    </ul>
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
