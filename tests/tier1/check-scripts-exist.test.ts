import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// F5 — companion test for scripts/check-scripts-exist.ts.
//
// The audit's finding was that the original check validated only one
// direction (package.json → disk), letting a script be referenced
// in package.json but absent from ci.yml — which is exactly how
// `e2e:parent-link-zero-js` slipped into "passing" status. This test
// pins the two-direction closure by simulating each shape of gap
// against a sandboxed package.json + ci.yml and asserting the check
// exits non-zero for the bad shape and zero for the good shape.
//
// Run via: `pnpm test tests/tier1/check-scripts-exist.test.ts`

type Sandbox = {
  root: string;
  pkg: { name: string; version: string; private: boolean; scripts: Record<string, string> };
  ci: string;
};

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "cse-"));
  const pkg = {
    name: "sandbox",
    version: "0.0.0",
    private: true,
    scripts: {
      "e2e:good": "tsx scripts/good.ts",
      "check:good": "tsx scripts/check-good.ts",
    } as Record<string, string>,
  };
  const ci = [
    "name: ci",
    "on: [push]",
    "jobs:",
    "  ci:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - run: pnpm e2e:good`,
    `      - run: pnpm check:good`,
  ].join("\n") + "\n";
  return { root, pkg, ci };
}

function applySandbox(s: Sandbox): void {
  mkdirSync(join(s.root, ".github", "workflows"), { recursive: true });
  mkdirSync(join(s.root, "scripts"), { recursive: true });
  writeFileSync(join(s.root, "package.json"), JSON.stringify(s.pkg, null, 2));
  writeFileSync(join(s.root, ".github", "workflows", "ci.yml"), s.ci);
  // Copy the in-repo check into the sandbox so the script under
  // test is the same code path CI runs. Without this, the test
  // would either rely on a relative path back into the repo (which
  // breaks the sandbox's hermetic intent) or re-implement the
  // check, which is not what F5 wants pinned.
  const realScript = readFileSync(
    join(process.cwd(), "scripts", "check-scripts-exist.ts"),
    "utf8",
  );
  writeFileSync(join(s.root, "scripts", "check-scripts-exist.ts"), realScript);
  // Provide on-disk entry points for the "good" scripts.
  writeFileSync(join(s.root, "scripts", "good.ts"), "// good\n");
  writeFileSync(join(s.root, "scripts", "check-good.ts"), "// good\n");
}

const sandboxes: Sandbox[] = [];

beforeAll(() => {
  for (let i = 0; i < 6; i++) sandboxes.push(makeSandbox());
});

afterAll(() => {
  for (const s of sandboxes) {
    try { rmSync(s.root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function runCheckInSandbox(s: Sandbox): { status: number; stdout: string; stderr: string } {
  try {
    const out = execFileSync("node", [
      "--experimental-strip-types",
      "scripts/check-scripts-exist.ts",
    ], {
      cwd: s.root,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: typeof e.status === "number" ? e.status : 1,
      stdout: typeof e.stdout === "string" ? e.stdout : e.stdout?.toString("utf8") ?? "",
      stderr: typeof e.stderr === "string" ? e.stderr : e.stderr?.toString("utf8") ?? "",
    };
  }
}

function mkdirSyncUnused(): void {
  // intentionally empty — see imports above.
}

void mkdirSyncUnused;

describe("check-scripts-exist two-direction closure", () => {
  it("passes when every script entry point exists on disk AND every e2e:/check: script is wired into ci.yml", () => {
    const s = sandboxes[0]!;
    applySandbox(s);
    const result = runCheckInSandbox(s);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/OK:/);
  });

  it("fails when a tsx entry point referenced in package.json is missing on disk (the original F5 gap)", () => {
    const s = sandboxes[1]!;
    applySandbox(s);
    // Delete the on-disk file but keep the package.json reference.
    rmSync(join(s.root, "scripts", "good.ts"));
    const result = runCheckInSandbox(s);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/missing on disk/);
    expect(result.stderr).toMatch(/e2e:good/);
  });

  it("fails when an e2e: script is in package.json but absent from ci.yml (the E1 follow-up shape that recurred)", () => {
    const s = sandboxes[2]!;
    applySandbox(s);
    // Remove the e2e:good line from ci.yml. Keep check:good wired.
    s.ci = s.ci.replace(/\s*- run: pnpm e2e:good\n/, "\n");
    writeFileSync(join(s.root, ".github", "workflows", "ci.yml"), s.ci);
    const result = runCheckInSandbox(s);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/absent from .github\/workflows\/ci.yml/);
    expect(result.stderr).toMatch(/e2e:good/);
  });

  it("fails when the only e2e: wiring is commented out (a 'commented to skip' shape must not pass)", () => {
    // The audit found a recurrence where `pnpm e2e:parent-link-zero-js`
    // was present in package.json and named in a ci.yml comment,
    // never invoked. The check must NOT match commented-out lines
    // as wiring — that's exactly the gap that produced the
    // recurrence.
    const s = sandboxes[2]!;
    applySandbox(s);
    s.ci = s.ci.replace(/- run: pnpm e2e:good/, "# - run: pnpm e2e:good");
    writeFileSync(join(s.root, ".github", "workflows", "ci.yml"), s.ci);
    const result = runCheckInSandbox(s);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/absent from .github\/workflows\/ci.yml/);
    expect(result.stderr).toMatch(/e2e:good/);
  });

  it("fails when a check: script is in package.json but absent from ci.yml (a check: phantom would otherwise pass)", () => {
    const s = sandboxes[3]!;
    applySandbox(s);
    s.ci = s.ci.replace(/\s*- run: pnpm check:good\n/, "\n");
    writeFileSync(join(s.root, ".github", "workflows", "ci.yml"), s.ci);
    const result = runCheckInSandbox(s);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/absent from .github\/workflows\/ci.yml/);
    expect(result.stderr).toMatch(/check:good/);
  });

  it("accepts `pnpm exec tsx <path>` invocation as a valid wiring (matches check:bundle / check:fonts style)", () => {
    const s = sandboxes[4]!;
    applySandbox(s);
    // Replace `pnpm e2e:good` with `pnpm exec tsx scripts/good.ts`,
    // the shape ci.yml uses for the bundle / font budget checks.
    s.ci = s.ci.replace("pnpm e2e:good", "pnpm exec tsx scripts/good.ts");
    writeFileSync(join(s.root, ".github", "workflows", "ci.yml"), s.ci);
    const result = runCheckInSandbox(s);
    expect(result.status).toBe(0);
  });

  it("non-e2e/non-check scripts are exempt — db:reset, dev, build, etc. need not be wired for this check to pass", () => {
    const s = sandboxes[5]!;
    applySandbox(s);
    s.pkg.scripts = {
      "e2e:good": "tsx scripts/good.ts",
      "check:good": "tsx scripts/check-good.ts",
      "db:reset": "tsx scripts/reset.ts", // intentional unwired — db: is dev-loop tooling
      "dev": "next dev",                   // dev-loop, not a CI gate
      "build": "next build",                // wired elsewhere
      "lint": "eslint .",                   // wired elsewhere
    };
    applySandbox(s);
    // Provide an on-disk stub so the disk-direction check passes
    // (the on-disk check applies to every script, not just the
    // e2e:/check: ones; this test only pins the wiring exemption).
    writeFileSync(join(s.root, "scripts", "reset.ts"), "// reset\n");
    const result = runCheckInSandbox(s);
    expect(result.status).toBe(0);
  });

  it("the script itself is wired into this repo's ci.yml — the wiring it enforces is itself enforced", () => {
    // The repo's own check must already be wired; if a future edit
    // removed that line, this test pins the regression.
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toMatch(/pnpm check:scripts-exist/);
  });
});

// The check imports node:fs / node:path at the top — verify those
// imports resolve in the repo, not just in the sandbox above.
// (The test runs against the sandbox via tsx --experimental-strip-types,
// but we want a smoke check that the in-repo file parses.)
describe("the in-repo check-scripts-exist.ts compiles", () => {
  it("parses cleanly with `node --check`", () => {
    const result = execFileSync("node", [
      "--check",
      "--experimental-strip-types",
      "scripts/check-scripts-exist.ts",
    ], { stdio: "pipe" });
    expect(result.toString()).toBe("");
  });
  it("on-disk entry point exists (the original disk-direction gap)", () => {
    expect(existsSync(join(process.cwd(), "scripts", "check-scripts-exist.ts"))).toBe(true);
  });
});
