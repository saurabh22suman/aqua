import { parseThemeId, resolveThemeId, type ThemeId } from "./themes";

// UI foundation — where the preset preference is stored.
//
// One cookie, read by the server on every render (app/layout.tsx) and
// written by the client when the user changes the preset:
//
//   aqua_theme=mint | lavender
//
// Why a cookie and not localStorage: the server must know the preset
// before it renders <html>, otherwise the first paint carries the
// default palette and the page flashes into the other one. A cookie is
// readable by the server on the request that renders the page, needs no
// client JavaScript to apply, and — like the existing facility
// preference — is a device-level display choice.
//
// Scope and honesty about the shared-device case: the preset is a
// colour scheme, not personal data. It is not tied to an account, so a
// device shared by two accounts shows the last chosen preset to both.
// clearThemeCookie() exists so the sign-out path can drop it; wiring
// that call is a change request to the auth/offline owner, recorded in
// the handoff.

export const THEME_COOKIE = "aqua_theme";

/** One year — the preset is a display preference, not a session value. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The preset stored in a raw cookie value. Returns null for an unknown
 * value so the caller can decide between "fall back" and "ignore".
 */
export function parseThemeCookie(raw: string | undefined | null): ThemeId | null {
  if (typeof raw !== "string") return null;
  return parseThemeId(raw.trim());
}

/**
 * The preset stored in a raw cookie value, falling back to the default
 * preset for an unknown or absent value.
 */
export function resolveThemeCookie(raw: string | undefined | null): ThemeId {
  return parseThemeCookie(raw) ?? resolveThemeId(undefined);
}

/** The cookie value for a preset. Only ever an approved preset id. */
export function themeCookieValue(theme: ThemeId): string {
  return theme;
}

/** Store the preset on the device (browser only). */
export function writeThemeCookie(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  const value = themeCookieValue(theme);
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/** Drop the stored preset (browser only) — used on sign-out. */
export function clearThemeCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
