import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// J3 — companion test for the liveness probe on every e2e script.
//
// The audit caught `waitForServer()` succeeding against a leftover
// `next start` from a previous run, silently re-running the
// assertions against yesterday's build and shipping. The fix is
// `assertPortFree(port)` at the top of every e2e script that
// spawns a dev/prod server — the probe tries to bind the port
// before any other setup and refuses to run if it's already
// listening.
//
// This test pins the property: every e2e script that spawns a
// server MUST call `assertPortFree(PORT)` BEFORE `spawn(...)`.
// If a future e2e script lands without the probe, or if the probe
// is moved after `spawn`, this test fails — the audit's exact
// failure shape must not recur.

const SCRIPTS_DIR = "scripts";

function readFileIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function listE2eScripts(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SCRIPTS_DIR)) {
    const full = join(SCRIPTS_DIR, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.startsWith("e2e-") || !entry.endsWith(".ts")) continue;
    out.push(full);
  }
  return out.sort();
}

describe("every e2e script that spawns a server MUST probe the port first (J3)", () => {
  const scripts = listE2eScripts();
  expect(scripts.length).toBeGreaterThan(0);

  for (const script of scripts) {
    const src = readFileIfExists(script);
    if (src === null) {
      it(`${script} — file exists`, () => {
        expect(src).not.toBeNull();
      });
      continue;
    }
    const spawnsServer = /\bspawn\(/.test(src);
    if (!spawnsServer) {
      // Script doesn't spawn a server (e.g. a helper). Skip —
      // the liveness probe is meaningless if there's no port to
      // probe.
      it.skip(`${script} does not spawn a server — liveness probe N/A`, () => {});
      continue;
    }
    const hasProbe = /assertPortFree\s*\(/.test(src);
    const probePosition = hasProbe ? src.search(/assertPortFree\s*\(/) : -1;
    const spawnPosition = src.search(/\bspawn\(/);

    it(`${script} defines assertPortFree`, () => {
      expect(hasProbe, `${script} must define assertPortFree() — see scripts/e2e-login.ts for the shape`).toBe(true);
    });

    it(`${script} calls assertPortFree BEFORE spawn`, () => {
      // The probe's whole point is to refuse to run against a
      // stale server. If the call site moves after `spawn(...)`,
      // a stale server can already be answering the script's
      // first fetch — the very gap the probe exists to close.
      expect(probePosition).toBeGreaterThanOrEqual(0);
      expect(spawnPosition).toBeGreaterThanOrEqual(0);
      expect(
        probePosition < spawnPosition,
        `${script}: assertPortFree(...) call site (line ${src.slice(0, probePosition).split("\n").length}) ` +
          `must come BEFORE spawn(...) (line ${src.slice(0, spawnPosition).split("\n").length}) ` +
          `— a stale server can already be answering fetches by the time spawn returns.`,
      ).toBe(true);
    });

    it(`${script}'s probe refuses to run on EADDRINUSE`, () => {
      // The probe's EADDRINUSE branch must surface a clear error,
      // not silently pass — the latter is exactly what the audit
      // caught. We assert the branch exists and that the error
      // message names the port (so the developer can find the
      // stale process).
      const probeMatch = src.match(/assertPortFree[\s\S]*?\n\}/);
      expect(probeMatch, `${script}: assertPortFree body not found`).not.toBeNull();
      const body = probeMatch![0]!;
      expect(body).toMatch(/EADDRINUSE/);
      expect(body).toMatch(/port\s+\$\{port\}|\bport \d|\bport `\${/);
    });
  }
});

describe("the probe shape itself (sanity — must match across all scripts)", () => {
  it("every e2e script's assertPortFree opens a node:net server", () => {
    const scripts = listE2eScripts();
    for (const script of scripts) {
      const src = readFileIfExists(script);
      if (src === null || !/\bspawn\(/.test(src)) continue;
      // The probe uses `createServer` from node:net. Some scripts
      // import it explicitly, others via the helper import. Either
      // shape is fine — we assert the body calls createServer().
      const probeMatch = src.match(/assertPortFree[\s\S]*?\n\}/);
      expect(probeMatch, `${script}: probe body not found`).not.toBeNull();
      expect(probeMatch![0]).toMatch(/createServer/);
    }
  });
});
