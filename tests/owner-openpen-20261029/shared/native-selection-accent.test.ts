import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Shared native selection-control accent contract (29 Oct 2026).
//
// A native checkbox/radio that a caller forgets to style must not fall
// back to the browser's blue. The base rule must use the preset's action
// token, stay in the base layer (so explicit utilities still win), and
// touch no geometry, disabled state or layout.

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const OPS_LAYOUT = readFileSync(
  join(process.cwd(), "app", "(platform)", "layout.tsx"),
  "utf8",
);

function blockAfter(source: string, selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  );
  const match = pattern.exec(source);
  if (!match) throw new Error(`selector ${selector} not found in globals.css`);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`selector ${selector} block is not closed`);
}

function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1]!, match[2]!.trim());
  }
  return out;
}

const BASE_LAYER = blockAfter(GLOBALS, "@layer base");
const ROOT = tokens(blockAfter(GLOBALS, ":root"));
const LAVENDER = tokens(blockAfter(GLOBALS, '[data-theme="lavender"]'));

function nativeSelectionRule(): { selector: string; body: string } {
  const pattern =
    /(:where\(input\[type="checkbox"\],\s*input\[type="radio"\]\)|input\[type="checkbox"\],\s*input\[type="radio"\])\s*\{([^}]*)\}/g;
  const match = pattern.exec(BASE_LAYER);
  if (!match) {
    throw new Error(
      "native checkbox/radio accent-color rule is missing from @layer base",
    );
  }
  return { selector: match[1]!, body: match[2]! };
}

describe("native checkbox/radio accent", () => {
  it("sets accent-color from the shared action token in the base layer", () => {
    const rule = nativeSelectionRule();
    expect(rule.selector.startsWith(":where(")).toBe(true);
    expect(rule.body).toMatch(/accent-color\s*:\s*var\(--accent-strong\)\s*;/);
    expect(rule.body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule.body).not.toContain("!important");
  });

  it("changes no glyph, hit area, disabled state or layout declaration", () => {
    const { body } = nativeSelectionRule();
    const declarations = body
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    expect(declarations).toEqual(["accent-color: var(--accent-strong)"]);
    expect(body).not.toMatch(/\b(width|height|min-width|min-height|padding|margin|appearance|opacity|display)\s*:/);
    expect(body).not.toContain(":disabled");
  });

  it("uses the token in both presets and is not owner-scoped away from Ops", () => {
    expect(ROOT.get("--accent-strong")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LAVENDER.get("--accent-strong")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(ROOT.get("--accent-strong")).not.toBe(
      LAVENDER.get("--accent-strong"),
    );
    const { selector } = nativeSelectionRule();
    expect(selector).not.toContain("[data-owner-surface]");
    expect(OPS_LAYOUT).not.toContain("--accent-strong");
  });
});
