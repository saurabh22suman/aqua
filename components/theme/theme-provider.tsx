"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { writeThemeCookie } from "@/lib/theme/storage";
import { DEFAULT_THEME, parseThemeId, type ThemeId } from "@/lib/theme/themes";

// UI foundation — the theme provider.
//
// The server already resolved the preset and rendered it onto <html>
// (app/layout.tsx), so the first paint already carries the palette and
// there is no flash to correct. This provider owns the live value and
// the switch: it applies the preset to the document element and stores
// it on the device.
//
// It is a display concern only. Nothing here reads a session, a
// permission or a tenant, and the value it holds is always one of the
// two approved presets.

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
};

/**
 * Apply a preset to the document and store it on the device.
 *
 * Defence in depth: the type says ThemeId, but a caller could pass an
 * arbitrary string at runtime. Only an approved preset ever reaches the
 * DOM or the cookie.
 */
export function applyTheme(theme: ThemeId): void {
  const validated = parseThemeId(theme);
  if (!validated) return;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = validated;
  }
  writeThemeCookie(validated);
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: ThemeId;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<ThemeId>(theme);

  const setTheme = useCallback((next: ThemeId) => {
    if (!parseThemeId(next)) return;
    setCurrent(next);
    applyTheme(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: current, setTheme }),
    [current, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// The fallback keeps a component that renders outside the provider (a
// component story, a test harness) working: the default preset is
// shown and a switch still applies. Inside the app the provider is
// always present — app/layout.tsx wraps the whole tree.
const FALLBACK: ThemeContextValue = {
  theme: DEFAULT_THEME,
  setTheme: applyTheme,
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK;
}
