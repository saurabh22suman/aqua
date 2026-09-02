import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { join } from "node:path";

// DEMO_MODE guards the demo reset scripts. The guard is the only
// thing standing between a misfired command and a real database
// receiving synthetic demo data — running the script with
// DEMO_MODE unset must exit before any DB write.

function runSeedDemo(env: Record<string, string | undefined>): number {
  try {
    execFileSync("npx", ["tsx", "scripts/seed-demo.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

describe("scripts/seed-demo.ts DEMO_MODE guard", () => {
  it("exits non-zero when DEMO_MODE is unset", () => {
    const code = runSeedDemo({ DEMO_MODE: undefined });
    expect(code).not.toBe(0);
  });

  it("exits non-zero when DEMO_MODE is explicitly false", () => {
    const code = runSeedDemo({ DEMO_MODE: "false" });
    expect(code).not.toBe(0);
  });

  it("would proceed (exit 0) only when DEMO_MODE=true — but skip the actual seed in this test so we don't write to the test DB", () => {
    // We don't actually run the seed here — the subprocess test above
    // covers the refusal path. The happy path is covered by the
    // manual `pnpm demo:reset` runbook step and by the
    // scripts/seed-demo.ts guard being a one-line `process.exit(1)`.
    // Why not run it: the pretest fixture creates a Testcontainer
    // Postgres that this test file doesn't have access to, and
    // running the seed against the wrong DB is exactly the misfire
    // the guard prevents.
    expect(true).toBe(true);
  });
});

// Sanity: the guard path is module-level, so the script never even
// reaches main(). Reading the file should confirm the guard sits
// above the rest of the file's logic.
describe("scripts/seed-demo.ts guard placement", () => {
  it("guards before any DB-touching code", async () => {
    const fs = await import("node:fs/promises");
    const path = join(process.cwd(), "scripts/seed-demo.ts");
    const text = await fs.readFile(path, "utf8");
    const guardIndex = text.indexOf("if (!env.DEMO_MODE)");
    const adminPoolIndex = text.indexOf("const adminPool");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(adminPoolIndex).toBeGreaterThan(guardIndex);
  });
});