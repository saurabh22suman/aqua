"use client";

import { cloneElement, type ReactElement } from "react";

// Phase 1 (mobile UX plan v2) — enforces the DESIGN.md §2 44×44
// minimum on an existing interactive child without changing its
// layout. cloneElement so the classes land on the real control (a
// wrapper span would add visual size but not hit area). `min={48}` is
// the research-preferred size for primary actions on budget Android.

export type TapProps = {
  children: ReactElement<{ className?: string }>;
  min?: 44 | 48;
};

const MIN_CLASS: Record<44 | 48, string> = {
  44: "min-h-11 min-w-11",
  48: "min-h-12 min-w-12",
};

export function Tap({ children, min = 44 }: TapProps) {
  const sizeClass = MIN_CLASS[min];
  const existing = children.props.className ?? "";
  return cloneElement(children, {
    className: existing ? `${existing} ${sizeClass}` : sizeClass,
  });
}
