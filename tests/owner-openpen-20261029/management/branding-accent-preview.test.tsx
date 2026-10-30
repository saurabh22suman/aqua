// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The branding preview must tell the truth.
//
// DESIGN.md §1.2: the tenant accent paints the ACADEMY MARK and is a
// branding token "and nothing else"; the action family
// (--accent/--accent-strong) belongs to the theme preset and paints the
// single primary action.
//
// The settings screen said the opposite: it painted an orange "Sample
// primary action" in the tenant accent and told the owner the accent
// "Applies to primary buttons and the mark itself". The real actions in
// the product use the preset's Mint/Lavender action colour, so the
// preview was lying about the one thing it exists to preview.
//
// What this pins:
//
//   * the identity preview shows the MARK and the NAME — never a
//     tenant-accent primary action;
//   * the copy says the accent paints the academy mark, and says
//     nothing about primary buttons;
//   * the six approved accent choices, the stored value and the mark's
//     own colour are all untouched.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["settings.manage"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("@/lib/actions/branding", () => ({
  getBrandingAction: async () => ({
    displayName: "Splash Sports Club",
    shortName: "Splash",
    accent: "mango",
    fallbackDisplayName: "Splash Sports Club",
    fallbackShortName: "Splash",
    initials: "SS",
  }),
  updateBrandingAction: async () => ({ ok: true }),
}));

import BrandingSettingsPage from "@/app/(owner)/owner/settings/branding/page";
import { ACCENTS, ACCENT_KEYS } from "@/lib/branding/accents";

afterEach(cleanup);

function accentColours(): Set<string> {
  const colours = new Set<string>();
  for (const accent of Object.values(ACCENTS)) {
    for (const value of [accent.base, accent.soft, accent.ink]) {
      const rgb = toRgb(value);
      if (rgb) colours.add(rgb);
    }
  }
  return colours;
}

/** jsdom normalises a hex colour to rgb(); compare on the parsed triple. */
function toRgb(colour: string): string | null {
  const probe = document.createElement("span");
  probe.style.color = colour;
  return probe.style.color ? probe.style.color.toLowerCase() : null;
}

describe("the branding identity preview", () => {
  it("does not offer a tenant-accent primary action", async () => {
    render(await BrandingSettingsPage());

    expect(screen.queryByTestId("branding-primary-sample")).toBeNull();
    expect(screen.queryByText(/sample primary action/i)).toBeNull();
  });

  it("does not tell the owner the accent applies to primary buttons", async () => {
    render(await BrandingSettingsPage());

    expect(screen.queryByText(/applies to primary buttons/i)).toBeNull();
  });

  it("says the accent paints the academy mark", async () => {
    render(await BrandingSettingsPage());

    expect(screen.getByText(/academy mark/i)).toBeTruthy();
  });

  it("paints the tenant accent on the mark and the swatches only", async () => {
    const { container } = render(await BrandingSettingsPage());

    const known = accentColours();
    const painted = Array.from(
      container.querySelectorAll<HTMLElement>("[style*='background-color']"),
    ).filter((element) =>
      known.has(toRgb(element.style.backgroundColor) ?? ""),
    );
    expect(painted.length).toBeGreaterThan(0);
    for (const element of painted) {
      // The only place a tenant accent may be painted is the accent
      // picker (the six swatches) and the academy mark itself.
      const inPicker = Boolean(element.closest("[data-testid='branding-accent']"));
      const inMark = Boolean(element.closest("svg"));
      expect(inPicker || inMark).toBe(true);
    }
  });

  it("keeps all six approved accent choices", async () => {
    render(await BrandingSettingsPage());

    const picker = screen.getByTestId("branding-accent");
    expect(picker.querySelectorAll("button")).toHaveLength(ACCENT_KEYS.length);
    const labels: Record<string, string> = {
      mango: "Mango",
      marine: "Marine",
      indigo: "Indigo",
      plum: "Plum",
      forest: "Forest",
      slate: "Slate",
    };
    for (const key of ACCENT_KEYS) {
      expect(screen.getByRole("button", { name: labels[key] })).toBeTruthy();
    }
  });

  it("keeps the chosen accent on the mark itself", async () => {
    const { container } = render(await BrandingSettingsPage());

    const rect = container.querySelector("svg rect");
    expect(rect?.getAttribute("fill")).toBe(ACCENTS.mango.soft);
  });

  it("moves the mark's colour with the chosen accent", async () => {
    const { container } = render(await BrandingSettingsPage());

    fireEvent.click(screen.getByRole("button", { name: /marine/i }));

    const rect = container.querySelector("svg rect");
    expect(rect?.getAttribute("fill")).toBe(ACCENTS.marine.soft);
  });
});
