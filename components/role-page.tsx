import type { ReactNode } from "react";

// The staff surfaces' shared frame.
//
// The coach, worker and reception entry pages are PHONE-first: one
// markup serves a 390 px phone and a 1280 px desktop. On a wide
// screen an unbounded column stretches the reading line to the window's
// edge, so the frame bounds the content to a comfortable measure and
// centres it.
//
// The top padding is compact. The tall phone default (pt-10) pushed
// the first action below the fold, and the surfaces that already used
// a tighter pad were not consistent with each other.
//
// This frame is layout only: it carries no data, adds no capability
// and changes no action.
export function RolePage({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-5 pb-8">{children}</main>
  );
}
