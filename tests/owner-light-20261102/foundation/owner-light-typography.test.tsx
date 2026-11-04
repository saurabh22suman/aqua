// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner light — FOUNDATION lane — the Owner-scoped typography contract.
//
// The approved mock (outputs/owner-mock-20261102/
// khelsuite-owner-light-type-mock.html, sha256 3bd4a553…c5bca5) sets ONE
// type family for the owner product:
//
//   --font: "Instrument Sans", ui-sans-serif, system-ui, …
//   body   400 16px/1.5
//   h1–h6  500, letter-spacing -0.01em
//   strong 500
//
// The application still carries the earlier HEAVY Owner display
// treatment: `@theme` declares `--font-display: "Bricolage Grotesque"`
// and the owner headings ask for it at weight 600.
//
// The contract this test pins:
//
//   1. the heavy display face is removed from the OWNER tree ONLY —
//      through an Owner-scoped token, so Ops, coach, reception, the
//      public pages and the auth panel keep the face they have today;
//   2. an Owner heading renders at the approved weight (500), also
//      scoped, so no other role's headings move;
//   3. the shared primitives keep asking for the shared display
//      utility: the Owner scope decides the family, the components do
//      not hardcode one;
//   4. the change introduces NO colour.
//
// The MEASURED proof (the computed family and weight in Chrome) is the
// coordinator's run of owner-light-foundation-chrome.cjs. jsdom cannot
// resolve a CSS custom property, so the assertions here pin the token
// and rule contract that produces that measurement.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner/members",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { OwnerShell } from "@/components/owner-shell";
import { PageHeader } from "@/components/ui/PageHeader";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

afterEach(cleanup);

/** The body of the first CSS block that starts with `selector`. */
function blockAfter(source: string, selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  );
  const match = pattern.exec(source);
  if (!match) throw new Error(`selector ${selector} not found in globals.css`);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`selector ${selector} block is not closed`);
}

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1]!, match[2]!.trim());
  }
  return out;
}

const OWNER_SCOPE = blockAfter(GLOBALS, "[data-owner-surface]");
const BASE_THEME = blockAfter(GLOBALS, "@theme");
const LAVENDER = blockAfter(GLOBALS, '[data-theme="lavender"]');
const ROOT = blockAfter(GLOBALS, ":root");

describe("owner typography — the heavy Owner display treatment is gone", () => {
  it("maps the Owner display face onto the body face inside the Owner scope", () => {
    const ownerTokens = declarations(OWNER_SCOPE);
    const display = ownerTokens.get("--font-display");

    // RED (observed): the Owner scope did not remap the display face, so
    // every owner heading still resolved to Bricolage Grotesque.
    expect(
      display,
      "[data-owner-surface] must remap --font-display to the body face",
    ).toBeTruthy();
    expect(display).toMatch(/var\(--font-sans\)|Instrument Sans/);
    expect(display).not.toMatch(/Bricolage/);
  });

  it("declares the approved Owner heading weight (500)", () => {
    expect(declarations(ROOT).get("--owner-heading-weight")).toBe("500");
  });

  it("applies the Owner heading weight to the Owner tree only", () => {
    // The rule is scoped to [data-owner-surface] and uses the token, so
    // the emphasis between 400 body text and a 500 heading stays
    // meaningful and no other role's headings move.
    const rule =
      /\[data-owner-surface\][^{]*:is\(h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\)[^{]*\{([^}]*)\}/.exec(
        GLOBALS,
      );
    expect(rule, "the owner scope must set the owner heading weight").toBeTruthy();
    expect(rule?.[1]).toContain("font-weight: var(--owner-heading-weight)");
  });

  it("maps the owner's 600 requests onto the real 500 face", () => {
    // The app loads only the 400 and 500 Instrument Sans faces, so a 600
    // request is drawn as a SYNTHESISED weight. Inside the owner tree it
    // is mapped onto the real 500.
    const rule =
      /\[data-owner-surface\][^{]*:is\(\.font-semibold,\s*\.kpi\)[^{]*\{([^}]*)\}/.exec(
        GLOBALS,
      );
    expect(rule, "the owner scope must map the 600 requests onto 500").toBeTruthy();
    expect(rule?.[1]).toContain("font-weight: var(--owner-heading-weight)");
  });

  it("renders the Owner wordmark at the approved heading weight (500)", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
    const brand = screen.getByTestId("owner-shell-brand");
    const wordmark = within(brand).getByText("KhelSuite");

    expect(wordmark.className).toContain("font-medium");
    expect(wordmark.className).not.toContain("font-semibold");
  });
});

describe("owner typography — what must NOT change", () => {
  it("keeps the shared display face for every other role", () => {
    expect(BASE_THEME).toContain("Bricolage Grotesque");
    expect(declarations(BASE_THEME).get("--font-display")).toContain(
      "Bricolage Grotesque",
    );
  });

  it("leaves the shared page title asking for the shared display utility", () => {
    // The Owner scope decides the family; the shared primitive does not
    // hardcode one, so a non-owner consumer of PageHeader keeps the
    // face it has today.
    render(<PageHeader title="Members" purpose="Everyone on the roster" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("font-display");
  });

  it("changes no palette colour in either preset", () => {
    expect(declarations(BASE_THEME).get("--color-deck")).toBe("#EDF0EC");
    expect(declarations(BASE_THEME).get("--color-ink")).toBe("#0F1F1C");
    expect(declarations(LAVENDER).get("--color-deck")).toBe("#F8F7FC");
    expect(declarations(LAVENDER).get("--color-ink")).toBe("#292136");
    // The semantic meanings never move with the theme.
    expect(declarations(BASE_THEME).get("--color-good")).toBe("#1F7A43");
    expect(declarations(BASE_THEME).get("--color-late")).toBe("#B2332B");
    expect(declarations(BASE_THEME).get("--color-warn")).toBe("#8F5400");
  });
});
