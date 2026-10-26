import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// UI foundation — the class merge helper.
//
// The shadcn convention: a caller-supplied `className` must be able to
// override a primitive's own classes (a variant's padding, a radius),
// not sit next to it and lose the specificity battle. tailwind-merge
// resolves conflicting Tailwind utilities in favour of the last one;
// clsx handles conditional class lists.
//
// Cost: ~7 KB gzipped for the pair, and only on routes that import a
// foundation primitive (recorded in the UI foundation handoff).

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
