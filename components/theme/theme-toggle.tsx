"use client";

import Palette from "lucide-react/dist/esm/icons/palette.mjs";
import { useTheme } from "@/components/theme/theme-provider";
import { themeDefinition } from "@/lib/theme/courtside";
import type { ThemeId } from "@/lib/theme/themes";

// UI foundation — the appearance control.
//
// One control, one action: cycle through the approved presets. The button
// carries the current and next preset in its accessible name, so a
// screen reader user hears what is active and what the control does —
// the colour swatch alone is never the only carrier of meaning
// (DESIGN.md §3).
//
// Owner redesign (27 October 2026) — a standard control: 48px, the
// shared control radius, 16px control text and the neutral entry
// border, so the appearance control in the owner header matches every
// other control in the shell.

const NEXT_THEME: Record<ThemeId, ThemeId> = {
  mint: "lavender",
  lavender: "dark",
  dark: "mint",
};

export function ThemeToggle({
  className = "",
  compact = false,
  courtside = false,
}: {
  className?: string;
  /** Icon-only header control; the accessible name still describes it. */
  compact?: boolean;
  /**
   * Owner redesign: name the presets by their courtside names. The ids,
   * the cookie and the provider are untouched — only the label and
   * tooltip text change.
   */
  courtside?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const next = NEXT_THEME[theme];
  const currentPreset = themeDefinition(theme, courtside);
  const nextPreset = themeDefinition(next, courtside);

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${currentPreset.label}. Switch to ${nextPreset.label}`}
      title={nextPreset.description}
      className={[
        "inline-flex min-h-12 flex-none items-center gap-2 rounded-ctl border border-[var(--control-border)] bg-paper px-4 text-[16px] font-medium text-ink-2",
        compact ? "justify-center px-3" : "",
        "motion-base hover:border-[var(--control-border-hover)] hover:bg-deck",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Palette size={18} strokeWidth={1.8} aria-hidden="true" />
      {compact ? null : <span className="hidden sm:inline">{currentPreset.label}</span>}
    </button>
  );
}
