import type { ReactNode } from "react";

// The frame of an unauthenticated screen: a full-height canvas, an
// optional editorial panel that only exists from `lg` up, and one
// column that carries the task.
//
// The document scrolls (DESIGN.md §2.1); the panel is viewport-bound and
// sticky, and the column is never a second scroller. The column is
// centred with auto margins rather than `justify-content: center`,
// because a centred flex item that overflows is unreachable at the top —
// what happens on a short viewport or when the phone's keyboard opens.

export function AuthShell({
  panel,
  children,
}: {
  panel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
      {panel}
      <main className="flex min-h-dvh flex-col px-5 pb-10 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[26rem] lg:my-auto">{children}</div>
      </main>
    </div>
  );
}
