// @vitest-environment jsdom
//
// Finance lane — RED (2 Nov 2026): the Owner SETTINGS category headings must
// draw the approved OUTLINE glyph, not the filled/duotone Khel family.
//
// The 184-view Chrome review found the Settings category headings still using
// the filled/duotone KhelIcon family, unlike the approved original outline
// pack. The approved mock's `var ICONS` map (mock lines 646-672) is the
// accepted geometry, and the shared Foundation-owned OwnerIcon carries it
// (24x24 viewBox, fill=none, stroke=currentColor, stroke-width 1.8, round
// caps/joins, decorative by default).
//
// This module (components/settings/settings-surfaces.tsx) is Owner-only and
// has exactly one consumer: the Owner Settings page. The category mapping is
// explicit and documented; no Khel family, global or other-role file changes.
//
// The geometry reference below is the approved mock's own paths, so the guard
// is independent of the shared component.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  categoryIcon,
  SettingsTaskSurface,
} from "@/components/settings/settings-surfaces";

afterEach(cleanup);

/**
 * The approved mock's own geometry for the six category glyphs
 * (mock ICONS: pin, programs, money, staff, bell, settings).
 */
const APPROVED_CATEGORY_GEOMETRY: Record<
  string,
  { name: string; elements: string[] }
> = {
  academy: {
    name: "pin",
    elements: [
      'path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21"',
      'circle cx="12" cy="10.3" r="2.4"',
    ],
  },
  programs: {
    name: "programs",
    elements: [
      'path d="M4 6.5h16M4 12h16M4 17.5h10"',
      'circle cx="18.5" cy="17.5" r="2"',
    ],
  },
  fees: {
    name: "money",
    elements: [
      'rect height="12" rx="2" width="17" x="3.5" y="6"',
      'path d="M3.5 10.5h17"',
      'path d="M7 14.5h4"',
    ],
  },
  team: {
    name: "staff",
    elements: [
      'circle cx="12" cy="8" r="3.4"',
      'path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"',
    ],
  },
  communications: {
    name: "bell",
    elements: [
      'path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10"',
      'path d="M10 18.5a2 2 0 0 0 4 0"',
    ],
  },
  appearance: {
    name: "settings",
    elements: [
      'circle cx="12" cy="12" r="3"',
      'path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"',
    ],
  },
};

/** The drawn child elements of a glyph, as `tag attr="value"` strings. */
function drawnElements(svg: SVGElement): string[] {
  return Array.from(svg.children).map((child) => {
    const attributes = Array.from(child.attributes)
      .map((attribute) => `${attribute.name}="${attribute.value}"`)
      .sort()
      .join(" ");
    return `${child.tagName.toLowerCase()} ${attributes}`;
  });
}

describe("Owner Settings category headings", () => {
  it("maps each category to its approved outline glyph", () => {
    expect(categoryIcon("academy")).toBe("pin");
    expect(categoryIcon("programs")).toBe("programs");
    expect(categoryIcon("fees")).toBe("money");
    expect(categoryIcon("team")).toBe("staff");
    expect(categoryIcon("communications")).toBe("bell");
    expect(categoryIcon("appearance")).toBe("settings");
  });

  it.each(Object.entries(APPROVED_CATEGORY_GEOMETRY))(
    "draws the %s heading as the approved %s outline",
    (key, approved) => {
      const { container } = render(
        <SettingsTaskSurface title={key} icon={categoryIcon(key) as never}>
          {null}
        </SettingsTaskSurface>,
      );
      const svg = container.querySelector("svg")!;

      // The approved outline contract: one 24x24 box, no fill, the current
      // text colour as the stroke, 1.8 stroke, round caps and joins.
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("fill")).toBe("none");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("stroke-width")).toBe("1.8");
      expect(svg.getAttribute("stroke-linecap")).toBe("round");
      expect(svg.getAttribute("stroke-linejoin")).toBe("round");
      // Decorative: the heading's own words carry the meaning.
      expect(svg.getAttribute("aria-hidden")).toBe("true");

      // The drawn geometry IS the approved mock's geometry — not merely
      // "some outline icon".
      expect(drawnElements(svg)).toEqual(approved.elements);
    },
  );

  it("keeps the heading words and the surface title", () => {
    const { container } = render(
      <SettingsTaskSurface title="Fees & payments" icon={categoryIcon("fees") as never}>
        {null}
      </SettingsTaskSurface>,
    );
    expect(container.querySelector("h2")?.textContent).toBe("Fees & payments");
  });
});
