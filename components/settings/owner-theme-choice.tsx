"use client";

import { useTheme } from "@/components/theme/theme-provider";
import { THEMES, THEME_IDS } from "@/lib/theme/themes";

// Owner appearance — the display preset as an explicit, named choice.
//
// 3 November 2026: the appearance page offered only the shared icon-only
// toggle, whose preset name lives in `<span className="hidden sm:inline">`.
// Below the `sm` breakpoint the owner therefore saw a palette glyph and
// could not tell that two approved light presets existed — which is what
// "the accent seems inactive" turned into in practice.
//
// This control names both approved presets, marks the current one as
// selected and calls the shared provider's `setTheme` with the matching
// enum value. It is a DISPLAY preference and nothing else:
//
//   * it is stored through the existing device cookie
//     (`lib/theme/storage.ts`) — no new cookie, config, account setting,
//     permission or data scope;
//   * it never reads a session, a tenant or a permission, so it can never
//     widen what the owner sees;
//   * the TENANT branding accent is a different thing and is untouched: it
//     still paints the academy mark, and nothing here deletes, resets or
//     re-points it.
//
// Native radio inputs inside a fieldset keep the platform's own keyboard
// behaviour (arrow keys move inside the group), form participation and
// screen-reader semantics, and the whole option row is the 44px target.

export function OwnerThemeChoice() {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset
      className="rounded-card border border-line bg-paper p-4 sm:p-5"
      data-testid="owner-theme-choice"
    >
      <legend className="font-display text-[16px] font-semibold text-ink">
        Theme
      </legend>
      <p className="mb-3 text-[12.5px] leading-snug text-ink-3">
        Saved on this device.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {THEME_IDS.map((id) => {
          const preset = THEMES[id];
          const selected = theme === id;
          return (
            <div
              key={id}
              data-testid={`theme-option-${id}`}
              data-selected={selected ? "true" : "false"}
              className={[
                "rounded-ctl border p-3",
                selected
                  ? "border-[var(--accent-strong)] bg-[var(--accent-soft)]"
                  : "border-line bg-paper",
              ].join(" ")}
            >
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="owner-theme"
                  value={id}
                  checked={selected}
                  onChange={() => setTheme(id)}
                  className="h-5 w-5 flex-none accent-[var(--accent-strong)]"
                />
                <span className="text-[14px] font-medium leading-tight text-ink">
                  {preset.label}
                </span>
              </label>
              <p className="mt-1 pl-8 text-[12px] leading-snug text-ink-3">
                {preset.description}
              </p>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
