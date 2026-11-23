// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OwnerThemeChoice } from "@/components/settings/owner-theme-choice";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { COURTSIDE_THEMES, themeDefinition } from "@/lib/theme/courtside";
import { THEMES, THEME_IDS } from "@/lib/theme/themes";

// Owner redesign — courtside appearance labels.
//
// The redesign renames the three approved presets on Owner surfaces only:
//
//   mint     → Court Blue
//   lavender → Clay Season
//   dark     → Floodlights
//
// The stored ids, the `aqua_theme` cookie and the provider contract must
// not change, and non-Owner surfaces must keep the foundation names.

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
  document.cookie = "aqua_theme=; path=/; max-age=0";
});

describe("courtside appearance — label API", () => {
  it("names the existing preset ids courtside", () => {
    expect(COURTSIDE_THEMES.mint.label).toBe("Court Blue");
    expect(COURTSIDE_THEMES.lavender.label).toBe("Clay Season");
    expect(COURTSIDE_THEMES.dark.label).toBe("Floodlights");
  });

  it("keeps every preset id unchanged", () => {
    for (const id of THEME_IDS) {
      expect(COURTSIDE_THEMES[id].id).toBe(id);
    }
  });

  it("falls back to the foundation names when courtside is not requested", () => {
    for (const id of THEME_IDS) {
      expect(themeDefinition(id)).toEqual(THEMES[id]);
      expect(themeDefinition(id, false)).toEqual(THEMES[id]);
    }
  });

  it("returns the courtside names only when the flag is on", () => {
    for (const id of THEME_IDS) {
      expect(themeDefinition(id, true)).toEqual(COURTSIDE_THEMES[id]);
    }
  });
});

describe("courtside appearance — controls", () => {
  it("labels the toggle and tooltip courtside for the Owner header", () => {
    render(
      <ThemeProvider theme="mint">
        <ThemeToggle courtside />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole("button", {
      name: "Theme: Court Blue. Switch to Clay Season",
    });
    expect(toggle.getAttribute("title")).toBe(
      COURTSIDE_THEMES.lavender.description,
    );
    expect(toggle.textContent).toContain("Court Blue");
  });

  it("keeps the existing names and cycling when courtside is omitted", () => {
    render(
      <ThemeProvider theme="mint">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole("button", {
      name: "Theme: Mint Garden. Switch to Lavender Club",
    });
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("lavender");
    expect(document.cookie).toContain("aqua_theme=lavender");
  });

  it("shows the courtside names in the Owner appearance choice", () => {
    render(
      <ThemeProvider theme="mint">
        <OwnerThemeChoice courtside />
      </ThemeProvider>,
    );

    for (const id of THEME_IDS) {
      expect(screen.getByTestId(`theme-option-${id}`).textContent).toContain(
        COURTSIDE_THEMES[id].label,
      );
    }
  });

  it("keeps the foundation names in the choice when courtside is omitted", () => {
    render(
      <ThemeProvider theme="mint">
        <OwnerThemeChoice />
      </ThemeProvider>,
    );

    for (const id of THEME_IDS) {
      expect(screen.getByTestId(`theme-option-${id}`).textContent).toContain(
        THEMES[id].label,
      );
    }
  });
});
