// scripts/check-focus-contrast.ts
//
// Enforces DESIGN.md §1.2: --focus-ring must meet WCAG 1.4.11
// (≥3:1) against every control surface — paper #FFFFFF and
// deck #EDF0EC today. Fails loudly (non-zero exit) if the token
// drops below threshold.
//
// Reads the value from app/globals.css so the check survives a
// palette rename. Refuses to silently pass on a non-literal value
// (e.g. color-mix(...)): a check that quietly stops checking is
// the failure mode this repo keeps producing, and the only way to
// not do that is to refuse a value the script cannot evaluate.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const GLOBAL_CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

const SURFACES = ["#FFFFFF", "#EDF0EC"] as const;
const MIN_RATIO = 3;

const literalHex = (line: string): string | null => {
  const m = line.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  return m ? m[0].toUpperCase() : null;
};

function lum(hex: string): number {
  const s = hex.replace("#", "");
  const full = s.length === 3
    ? s.split("").map((c) => c + c).join("")
    : s.length === 8
      ? s.slice(0, 6)
      : s;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function main(): void {
  const focusLine = GLOBAL_CSS.split(/\r?\n/).find((l) => /--focus-ring:/.test(l));
  if (!focusLine) {
    console.error("[✗] --focus-ring token not declared in app/globals.css");
    process.exit(1);
  }
  const fg = literalHex(focusLine);
  if (!fg) {
    console.error(
      "[✗] --focus-ring is not a literal hex value. " +
        "The check refuses to evaluate CSS expressions — " +
        "if you must express the colour, hard-code a hex and re-run.",
    );
    console.error(`    ${focusLine.trim()}`);
    process.exit(1);
  }
  let bad = false;
  for (const bg of SURFACES) {
    const r = ratio(fg, bg);
    const ok = r >= MIN_RATIO;
    console.log(`--focus-ring ${fg} on ${bg} = ${r.toFixed(2)}:1 ${ok ? "✓" : "✗"}`);
    if (!ok) bad = true;
  }
  if (bad) {
    console.error(`[✗] --focus-ring fails WCAG 1.4.11 (${MIN_RATIO}:1) on at least one control surface`);
    process.exit(1);
  }
  console.log(`[✓] --focus-ring meets WCAG 1.4.11 on every control surface`);
}

main();
