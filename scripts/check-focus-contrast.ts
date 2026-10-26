// scripts/check-focus-contrast.ts
//
// Enforces DESIGN.md §1.2: --focus-ring must meet WCAG 1.4.11 (≥3:1)
// against every control surface — of EVERY preset.
//
// The app ships two light presets (Mint Garden, Lavender Club). Each
// preset declares its own ring and its own surfaces, so the check walks
// every preset block in app/globals.css and compares that preset's ring
// with that preset's canvas and surface. A stylesheet may be passed as
// the first argument (defaults to app/globals.css) so a fixture can be
// checked; the script refuses to pass on a value it cannot evaluate
// (e.g. color-mix(...)) — a check that quietly stops checking is the
// failure mode this repo keeps producing.
//
// Reads the value from app/globals.css so the check survives a palette
// rename.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIN_RATIO = 3;

// The surfaces a control can be drawn on. The canvas and the raised
// surface are required: a stylesheet without them cannot be checked.
// The pastel owner surfaces (the desktop sidebar, the metric tiles) and
// the shared late surface are checked when the stylesheet declares
// them — a focus ring on a pastel tile still has to be visible.
const REQUIRED_SURFACES = ["--color-deck", "--color-paper"];
const OPTIONAL_SURFACES = [
  "--color-sidebar",
  "--color-tile-money",
  "--color-tile-info",
  "--color-tile-butter",
  "--color-late-soft",
];
const CONTROL_SURFACES = [...REQUIRED_SURFACES, ...OPTIONAL_SURFACES];

type Preset = {
  /** "default" for :root, or the data-theme value. */
  name: string;
  /** The block's own declarations. */
  props: Map<string, string>;
};

export type PresetFinding = {
  preset: string;
  ring: string;
  surface: string;
  ratio: number;
  ok: boolean;
};

export type FocusContrastReport = {
  findings: PresetFinding[];
  /** Human-readable reasons the check could not be evaluated. */
  problems: string[];
};

/**
 * A colour the checker can reason about: an sRGB triple with an alpha
 * channel.
 *
 * Only a *literal* hex colour is accepted. An expression
 * (`color-mix(...)`, `rgb(...)`, a variable) cannot be evaluated
 * honestly from the stylesheet, so it fails the check instead of being
 * approximated — the quick review (batch 3) found the earlier parser
 * taking the first hex *inside* an expression and measuring that, which
 * is a false pass.
 */
export type ParsedColour = {
  rgb: [number, number, number];
  alpha: number;
  /** The literal as written, for the report. */
  literal: string;
};

export function parseColour(value: string): ParsedColour | null {
  const trimmed = value.trim();
  const match = /^#([0-9a-fA-F]+)$/.exec(trimmed);
  if (!match) return null;
  const hex = match[1]!;
  const expand = (part: string) => parseInt(part, 16);

  if (hex.length === 3) {
    return {
      rgb: [
        expand(hex[0]! + hex[0]!),
        expand(hex[1]! + hex[1]!),
        expand(hex[2]! + hex[2]!),
      ],
      alpha: 1,
      literal: trimmed.toUpperCase(),
    };
  }
  if (hex.length === 6) {
    return {
      rgb: [
        expand(hex.slice(0, 2)),
        expand(hex.slice(2, 4)),
        expand(hex.slice(4, 6)),
      ],
      alpha: 1,
      literal: trimmed.toUpperCase(),
    };
  }
  if (hex.length === 8) {
    return {
      rgb: [
        expand(hex.slice(0, 2)),
        expand(hex.slice(2, 4)),
        expand(hex.slice(4, 6)),
      ],
      alpha: expand(hex.slice(6, 8)) / 255,
      literal: trimmed.toUpperCase(),
    };
  }
  // 4- and 7-digit hexes are not CSS colours: refuse rather than guess.
  return null;
}

/**
 * Source-over compositing: what the ring actually looks like where it
 * is drawn on the surface. A translucent ring measured as if it were
 * opaque is a false pass — the quick review (batch 3) found exactly
 * that (a 50% ring measured at its opaque contrast).
 */
export function composite(
  fg: ParsedColour,
  bg: ParsedColour,
): [number, number, number] {
  const a = fg.alpha;
  return [
    fg.rgb[0] * a + bg.rgb[0] * (1 - a),
    fg.rgb[1] * a + bg.rgb[1] * (1 - a),
    fg.rgb[2] * a + bg.rgb[2] * (1 - a),
  ];
}

export function luminanceOf(rgb: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

export function ratioOf(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The contents of the block that starts at the first `{` after `at`. */
function blockAt(source: string, at: number): string | null {
  const open = source.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Comments are prose, not declarations. The stylesheet explains the
 * tokens in prose (and names the selectors while doing so), so the
 * blocks are read from a comment-free copy — otherwise a sentence
 * mentioning `:root` would be parsed as a preset.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1]!, match[2]!.trim());
  }
  return out;
}

/** The base palette (@theme) — the fallback for a preset that does not restate a colour. */
function basePalette(source: string): Map<string, string> {
  const at = source.indexOf("@theme");
  if (at === -1) return new Map();
  const block = blockAt(source, at);
  return block ? declarations(block) : new Map();
}

/** Every preset block: :root (the default) and each [data-theme="…"]. */
export function presetBlocks(source: string): Preset[] {
  const css = stripComments(source);
  const presets: Preset[] = [];

  const rootPattern = /:root(?![-\w])[^{}]*\{/g;
  for (const match of css.matchAll(rootPattern)) {
    const block = blockAt(css, match.index!);
    if (block) presets.push({ name: "default", props: declarations(block) });
  }

  const themePattern = /\[data-theme\s*=\s*["']([^"']+)["']\][^{}]*\{/g;
  for (const match of css.matchAll(themePattern)) {
    const block = blockAt(css, match.index!);
    if (block) presets.push({ name: match[1]!, props: declarations(block) });
  }

  return presets;
}

export function checkFocusContrast(source: string): FocusContrastReport {
  const base = basePalette(source);
  const presets = presetBlocks(source);
  const findings: PresetFinding[] = [];
  const problems: string[] = [];

  if (presets.length === 0) {
    problems.push("no preset block found in the stylesheet (:root or [data-theme=\"…\"])");
    return { findings, problems };
  }

  for (const preset of presets) {
    const ringValue = preset.props.get("--focus-ring");
    if (!ringValue) {
      problems.push(
        `preset "${preset.name}" declares no --focus-ring token — the focus indicator cannot be evaluated`,
      );
      continue;
    }
    const ring = parseColour(ringValue);
    if (!ring) {
      problems.push(
        `preset "${preset.name}" has a --focus-ring that is not a literal hex colour ` +
          `(${ringValue}). The check refuses to evaluate CSS expressions — if you must express the colour, hard-code a hex and re-run.`,
      );
      continue;
    }

    for (const surfaceToken of CONTROL_SURFACES) {
      const declared = preset.props.get(surfaceToken) ?? base.get(surfaceToken);
      if (!declared) {
        // A required surface that the preset does not declare cannot be
        // evaluated — that is a broken stylesheet, not an unused token.
        if (REQUIRED_SURFACES.includes(surfaceToken)) {
          problems.push(
            `preset "${preset.name}" has no ${surfaceToken} (neither in the preset nor in @theme) — the contrast cannot be evaluated`,
          );
        }
        // An optional surface (a pastel tile, the sidebar) that the
        // stylesheet does not declare at all is simply not painted on
        // that preset; there is nothing to compare.
        continue;
      }
      const surfaceValue = declared;
      const surface = parseColour(surfaceValue);
      if (!surface) {
        problems.push(
          `preset "${preset.name}" has a ${surfaceToken} that is not a literal hex colour ` +
            `(${surfaceValue}) — the contrast cannot be evaluated`,
        );
        continue;
      }
      if (surface.alpha < 1) {
        // The backdrop behind a translucent surface is not knowable from
        // the stylesheet, so no honest comparison exists.
        problems.push(
          `preset "${preset.name}" has a translucent surface (${surfaceToken} = ${surface.literal}) — ` +
            `the backdrop behind it is unknown, so the contrast cannot be evaluated`,
        );
        continue;
      }
      // What the ring actually looks like where it is drawn.
      const drawn = composite(ring, surface);
      const measured = ratioOf(drawn, surface.rgb);
      findings.push({
        preset: preset.name,
        ring: ring.literal,
        surface: surface.literal,
        ratio: measured,
        ok: measured >= MIN_RATIO,
      });
    }
  }

  return { findings, problems };
}

function main(): void {
  const cssPath = process.argv[2] ?? join(ROOT, "app", "globals.css");
  let source: string;
  try {
    source = readFileSync(cssPath, "utf8");
  } catch {
    console.error(`[✗] could not read the stylesheet: ${cssPath}`);
    process.exit(1);
  }

  const { findings, problems } = checkFocusContrast(source);

  for (const finding of findings) {
    console.log(
      `--focus-ring ${finding.ring} (${finding.preset}) on ${finding.surface} = ${finding.ratio.toFixed(2)}:1 ${finding.ok ? "✓" : "✗"}`,
    );
  }
  for (const problem of problems) {
    console.error(`[✗] ${problem}`);
  }

  const failed = findings.filter((finding) => !finding.ok);
  if (failed.length > 0) {
    for (const finding of failed) {
      console.error(
        `[✗] preset "${finding.preset}": --focus-ring ${finding.ring} is ${finding.ratio.toFixed(2)}:1 on ${finding.surface} — WCAG 1.4.11 needs ${MIN_RATIO}:1`,
      );
    }
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error("[✗] the focus contrast could not be evaluated for every preset");
    process.exit(1);
  }
  if (findings.length === 0) {
    console.error("[✗] no focus ring was evaluated — the check is not checking anything");
    process.exit(1);
  }
  console.log(
    `[✓] every preset's focus ring meets WCAG 1.4.11 (${MIN_RATIO}:1) on every control surface`,
  );
}

// Only run the CLI when this file is the entry point, so a test can
// import the checker without executing it.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main();
}
