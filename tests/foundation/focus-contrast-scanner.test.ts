import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// UI foundation — the focus-contrast scanner must check EVERY preset.
//
// scripts/check-focus-contrast.ts used to read the first `--focus-ring`
// line and compare it against two hardcoded Mint surfaces. The app now
// ships two light presets (Mint Garden, Lavender Club) and the second
// preset declares its own ring, so the gate was reporting "✓ on every
// control surface" while the Lavender ring was never evaluated.
//
// These are the scanner's own tests (the scanner is a script, not
// product code). They run it against the real stylesheet and against
// fixtures where one preset fails, so a regression cannot be hidden by
// the scanner's own parsing.
//
// RED status at the time of writing: the scanner accepts no stylesheet
// argument (it always reads app/globals.css) and evaluates only the
// first ring, so every "a failing preset must fail the run" case here
// passes the run instead of failing it.

const ROOT = process.cwd();
const SCANNER = join(ROOT, "scripts", "check-focus-contrast.ts");

function writeFixture(css: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aqua-focus-"));
  const file = join(dir, "globals.css");
  writeFileSync(file, css, "utf8");
  return file;
}

type ScanResult = { status: number; output: string };

function runScanner(cssPath?: string): ScanResult {
  const args = cssPath ? [SCANNER, cssPath] : [SCANNER];
  try {
    const output = execFileSync("pnpm", ["exec", "tsx", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

const PASSING_FIXTURE = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --focus-ring: #1F5E3A;
}
[data-theme="lavender"] {
  --color-deck: #F6F3FB;
  --color-paper: #FFFFFF;
  --focus-ring: #4C2E93;
}
`;

const FAILING_SECOND_PRESET = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --focus-ring: #1F5E3A;
}
[data-theme="lavender"] {
  --color-deck: #F6F3FB;
  --color-paper: #FFFFFF;
  --focus-ring: #F6F3FB;
}
`;

const FAILING_FIRST_PRESET = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --focus-ring: #EDF0EC;
}
[data-theme="lavender"] {
  --color-deck: #F6F3FB;
  --color-paper: #FFFFFF;
  --focus-ring: #4C2E93;
}
`;

const MISSING_RING = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --accent: #1F5E3A;
}
`;

// The quick review (batch 3) found that the scanner extracted the FIRST
// hex out of an expression and dropped the alpha of an 8-digit colour:
// a `color-mix(...)` ring was evaluated as if it were its first hex, and
// a half-transparent ring was measured as fully opaque. Both are false
// passes. The scanner must fail closed on an expression and must
// composite a translucent ring over the surface it is drawn on.

const RING_AS_EXPRESSION = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --focus-ring: color-mix(in srgb, #1F5E3A 50%, #FFFFFF);
}
`;

const RING_HALF_TRANSPARENT = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --focus-ring: #1F5E3A80;
}
`;

const RING_FULLY_TRANSPARENT = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --focus-ring: #1F5E3A00;
}
`;

const RING_OPAQUE_EIGHT_DIGIT = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF;
}
:root {
  --focus-ring: #1F5E3AFF;
}
`;

const SURFACE_TRANSLUCENT = `@theme {
  --color-deck: #EDF0EC;
  --color-paper: #FFFFFF80;
}
:root {
  --focus-ring: #1F5E3A;
}
`;

describe("focus-contrast scanner — every preset is checked", () => {
  it("passes for the real stylesheet", () => {
    const result = runScanner();
    expect(result.status).toBe(0);
  });

  it("passes for a stylesheet whose presets all meet 3:1", () => {
    const result = runScanner(writeFixture(PASSING_FIXTURE));
    expect(result.status).toBe(0);
  });

  it("fails when a preset other than the first breaks 3:1", () => {
    const result = runScanner(writeFixture(FAILING_SECOND_PRESET));
    expect(result.status).not.toBe(0);
    // The failure must name the preset that failed, not just "a ring".
    expect(result.output).toContain("lavender");
  });

  it("fails when the first preset breaks 3:1", () => {
    const result = runScanner(writeFixture(FAILING_FIRST_PRESET));
    expect(result.status).not.toBe(0);
  });

  it("fails loudly when a preset declares no ring at all", () => {
    const result = runScanner(writeFixture(MISSING_RING));
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/focus-ring/i);
  });

  it("reads the stylesheet from the argument when one is given", () => {
    // The real stylesheet passes; a fixture that fails must fail the
    // run. If the argument were ignored, the failing fixture would
    // "pass" against the real file.
    const result = runScanner(writeFixture(FAILING_SECOND_PRESET));
    expect(result.status).not.toBe(0);
  });
});

describe("focus-contrast scanner — unsupported colour expressions fail closed", () => {
  it("refuses to evaluate a ring written as an expression", () => {
    const result = runScanner(writeFixture(RING_AS_EXPRESSION));
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/literal|expression/i);
  });

  it("does not pass a half-transparent ring", () => {
    // #1F5E3A80 is the forest ring at 50% alpha. Over white it is
    // roughly #8FAF9C — about 2.4:1, below the 3:1 floor. Measured as
    // if it were opaque it would have passed at 7.72:1.
    const result = runScanner(writeFixture(RING_HALF_TRANSPARENT));
    expect(result.status).not.toBe(0);
  });

  it("does not pass a fully transparent ring", () => {
    const result = runScanner(writeFixture(RING_FULLY_TRANSPARENT));
    expect(result.status).not.toBe(0);
  });

  it("accepts an opaque eight-digit colour as the colour it is", () => {
    const result = runScanner(writeFixture(RING_OPAQUE_EIGHT_DIGIT));
    expect(result.status).toBe(0);
  });

  it("refuses to evaluate against a translucent surface", () => {
    // The backdrop behind a translucent surface is not knowable from
    // the stylesheet, so the comparison cannot be honest.
    const result = runScanner(writeFixture(SURFACE_TRANSLUCENT));
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/surface/i);
  });
});
