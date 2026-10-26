"use client";

import { Palette } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { THEMES, type ThemeId } from "@/lib/theme/themes";

// UI foundation — the appearance control.
//
// One control, one action: switch to the other preset. The button
// carries the current and next preset in its accessible name, so a
// screen reader user hears what is active and what the control does —
// the colour swatch alone is never the only carrier of meaning
// (DESIGN.md §3).

const NEXT_THEME: Record<ThemeId, ThemeId> = {
  mint: "lavender",
  lavender: "mint",
};

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const next = NEXT_THEME[theme];

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${THEMES[theme].label}. Switch to ${THEMES[next].label}`}
      title={THEMES[next].description}
      className={[
        "inline-flex min-h-11 flex-none items-center gap-2 rounded-ctl border border-line bg-paper px-3 text-[13px] font-medium text-ink-2",
        "motion-base hover:bg-deck",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Palette size={18} strokeWidth={1.8} aria-hidden="true" />
      <span className="hidden sm:inline">{THEMES[theme].label}</span>
    </button>
  );
}
