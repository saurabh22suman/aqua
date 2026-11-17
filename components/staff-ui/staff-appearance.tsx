"use client";

import { useTheme } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { THEMES } from "@/lib/theme/themes";

// Staff appearance — the display preset, on the staff self-service
// surfaces.
//
// A successful staff sign-in deliberately clears the device's
// `aqua_theme` cookie, and until now the staff surfaces carried NO
// appearance control at all, so a coach, receptionist or worker could
// never reach the second approved light preset from the product. The
// owner shell already owns the control (components/theme/theme-toggle)
// and the whole app is wrapped in the existing ThemeProvider, so this
// row reuses both.
//
// It adds NO state mechanism: the same provider, the same device cookie
// and the same control, and the login/auth cookie clearing is
// untouched. The row states the CURRENT preset in words, so the reader
// on a phone — where the control is the palette glyph — can still see
// which preset is active; the control's accessible name carries both
// the current and the next preset.
//
// The row carries no personal name: the appearance control says what
// it changes, and the person's own identity stays in the identity
// block above it.

export function StaffAppearance() {
  const { theme } = useTheme();

  return (
    <section
      data-testid="staff-appearance"
      className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-3.5 py-3"
    >
      <div className="min-w-0">
        <h2 className="text-[14px] font-medium leading-tight text-ink">
          Appearance
        </h2>
        <p className="mt-0.5 text-[12px] leading-tight text-ink-3">
          {THEMES[theme].label} · saved on this device
        </p>
      </div>
      <ThemeToggle />
    </section>
  );
}
