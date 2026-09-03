import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { confirmationMatches, describeTarget, evaluateResetGuard } from "@/db/reset-guard";

// db/reset.ts drops and recreates the entire public schema. The
// demo:reset wrapper (scripts/demo-reset.ts) gates on DEMO_MODE before
// calling it, but db/reset.ts is also runnable standalone (`pnpm
// db:reset`, CI's own db:reset step) and must refuse on its own —
// the wrapper's guard does nothing for that path. This is a bigger
// blast radius than anything DEMO_MODE was built to prevent, so it
// gets its own gate: unconditional refusal in production, and refusal
// everywhere else unless DEMO_MODE=true or --i-understand is explicit.

describe("evaluateResetGuard", () => {
  it("refuses unconditionally when NODE_ENV=production, even with DEMO_MODE=true", () => {
    const decision = evaluateResetGuard({ nodeEnv: "production", demoMode: true, argv: [] });
    expect(decision.allowed).toBe(false);
  });

  it("refuses unconditionally when NODE_ENV=production, even with --i-understand", () => {
    const decision = evaluateResetGuard({
      nodeEnv: "production",
      demoMode: false,
      argv: ["--i-understand"],
    });
    expect(decision.allowed).toBe(false);
  });

  it("refuses in development when DEMO_MODE is false and no flag is passed", () => {
    const decision = evaluateResetGuard({ nodeEnv: "development", demoMode: false, argv: [] });
    expect(decision.allowed).toBe(false);
  });

  it("refuses in test when DEMO_MODE is false and no flag is passed", () => {
    const decision = evaluateResetGuard({ nodeEnv: "test", demoMode: false, argv: [] });
    expect(decision.allowed).toBe(false);
  });

  it("allows in development when DEMO_MODE is true", () => {
    const decision = evaluateResetGuard({ nodeEnv: "development", demoMode: true, argv: [] });
    expect(decision.allowed).toBe(true);
  });

  it("allows in test when --i-understand is passed, even with DEMO_MODE false", () => {
    const decision = evaluateResetGuard({
      nodeEnv: "test",
      demoMode: false,
      argv: ["--i-understand"],
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("describeTarget", () => {
  it("extracts host and database name from a connection string", () => {
    expect(describeTarget("postgresql://aqua:aqua@localhost:5432/aqua")).toEqual({
      host: "localhost",
      database: "aqua",
    });
  });

  it("extracts host and database name for a remote host", () => {
    expect(
      describeTarget("postgres://user:pw@prod-db.example.com:5432/aqua_production"),
    ).toEqual({ host: "prod-db.example.com", database: "aqua_production" });
  });
});

describe("confirmationMatches", () => {
  it("matches an exact database name", () => {
    expect(confirmationMatches("aqua", "aqua")).toBe(true);
  });

  it("matches after trimming surrounding whitespace", () => {
    expect(confirmationMatches("  aqua  ", "aqua")).toBe(true);
  });

  it("rejects a mismatched name", () => {
    expect(confirmationMatches("aqua_production", "aqua")).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(confirmationMatches("", "aqua")).toBe(false);
  });
});

// Subprocess tests: confirm the actual script refuses before touching
// the database, mirroring the pattern in
// tests/tier1/demo-mode-seed-guard.test.ts. We never exercise the
// allowed path here — that would drop the schema of whatever database
// this test process is connected to.
function runDbReset(env: Record<string, string | undefined>, argv: string[] = []): number {
  try {
    execFileSync("npx", ["tsx", "db/reset.ts", ...argv], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

describe("db/reset.ts guard (subprocess)", () => {
  it("exits non-zero when NODE_ENV=production", () => {
    const code = runDbReset({
      NODE_ENV: "production",
      DEMO_MODE: "false",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://aqua.example.com",
    });
    expect(code).not.toBe(0);
  });

  it("exits non-zero when DEMO_MODE is unset and no --i-understand flag is passed", () => {
    const code = runDbReset({ NODE_ENV: "development", DEMO_MODE: undefined });
    expect(code).not.toBe(0);
  });

  // The allowed path (DEMO_MODE=true, or --i-understand) is covered by
  // CI's own `pnpm db:reset --i-understand` step and by
  // `DEMO_MODE=true pnpm demo:reset` in the runbook — not re-run here
  // for the same reason the seed-demo guard test skips it: running it
  // would drop the schema of whichever database this test process is
  // pointed at.
});

// Sanity: the guard sits above any DB-touching code in the script
// itself, matching the placement check pattern used for
// scripts/seed-demo.ts.
describe("db/reset.ts guard placement", () => {
  it("evaluates the guard before connecting to Postgres", async () => {
    const fs = await import("node:fs/promises");
    const path = (await import("node:path")).join(process.cwd(), "db/reset.ts");
    const text = await fs.readFile(path, "utf8");
    const guardIndex = text.indexOf("evaluateResetGuard(");
    const connectIndex = text.indexOf("client.connect()");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(connectIndex).toBeGreaterThan(guardIndex);
  });
});
