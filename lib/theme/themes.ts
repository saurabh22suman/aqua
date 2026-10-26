import { z } from "zod";

// UI foundation — the approved theme presets.
//
// The human decision (docs/design-system/README.md, "Approved direction")
// is exactly TWO LIGHT presets: Mint Garden (default) and Lavender Club.
// One layout, typography, spacing and component behaviour across both.
//
// A preset is a personal display preference. It is NOT tenant branding
// and it never carries a permission, a data scope or an identity, so it
// must never be read by an action, a query or a guard — this module
// deliberately imports nothing from the database or the auth context.
//
// The stored value is always validated against this enum: a stale or
// tampered value falls back to the default instead of reaching the DOM.

export const THEME_IDS = ["mint", "lavender"] as const;

export const themeIdSchema = z.enum(THEME_IDS);

export type ThemeId = z.infer<typeof themeIdSchema>;

export const DEFAULT_THEME: ThemeId = "mint";

export type ThemeDefinition = {
  id: ThemeId;
  /** Human label shown in the appearance control. */
  label: string;
  /** One line explaining what the preset changes. */
  description: string;
};

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  mint: {
    id: "mint",
    label: "Mint Garden",
    description: "Warm white and pale mint with deep forest actions.",
  },
  lavender: {
    id: "lavender",
    label: "Lavender Club",
    description: "White and pale lilac with violet actions and aubergine text.",
  },
};

export function isThemeId(value: unknown): value is ThemeId {
  return themeIdSchema.safeParse(value).success;
}

/** The stored value, or null when it is not one of the approved presets. */
export function parseThemeId(value: unknown): ThemeId | null {
  const parsed = themeIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The stored value, or the default preset when it is unknown. */
export function resolveThemeId(value: unknown): ThemeId {
  return parseThemeId(value) ?? DEFAULT_THEME;
}
