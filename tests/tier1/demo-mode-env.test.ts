import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

// DEMO_MODE is the gate for the demo reset path: an env var
// accidentally set against a real club's deployment must not seed demo
// members. `parseEnv` is the exported parser (see lib/env.ts); the
// module-level `env` runs the same parser at import time, so a real
// `next start` with DEMO_MODE=true + NODE_ENV=production crashes on
// first import. These tests exercise the four combinations that
// matter.

const BASE: Record<string, string> = {
  DATABASE_URL: "postgres://app:pw@localhost:5432/aqua",
};

describe("parseEnv — DEMO_MODE boot-fail", () => {
  it("refuses to boot when DEMO_MODE=true and NODE_ENV=production", () => {
    expect(() =>
      parseEnv({ ...BASE, DEMO_MODE: "true", NODE_ENV: "production" }),
    ).toThrow(/DEMO_MODE=true is not permitted in production/);
  });

  it("allows DEMO_MODE=true in development", () => {
    const parsed = parseEnv({ ...BASE, DEMO_MODE: "true", NODE_ENV: "development" });
    expect(parsed.DEMO_MODE).toBe(true);
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("allows DEMO_MODE=false in production (default-off)", () => {
    const parsed = parseEnv({
      ...BASE,
      DEMO_MODE: "false",
      NODE_ENV: "production",
      // Production requires the same env vars it always requires;
      // what this test pins is specifically that DEMO_MODE=false
      // does not flip the boot-fail on top of those.
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://aqua.example.com",
    });
    expect(parsed.DEMO_MODE).toBe(false);
    expect(parsed.NODE_ENV).toBe("production");
  });

  it("defaults DEMO_MODE to false when unset", () => {
    const parsed = parseEnv({ ...BASE, NODE_ENV: "development" });
    expect(parsed.DEMO_MODE).toBe(false);
  });

  it("treats empty DEMO_MODE as false (not 'true' string)", () => {
    const parsed = parseEnv({ ...BASE, DEMO_MODE: "", NODE_ENV: "development" });
    expect(parsed.DEMO_MODE).toBe(false);
  });

  it("exempts the next-build phase from the boot-fail (developers with DEMO_MODE=true in .env must still be able to run pnpm build)", () => {
    const previous = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
    try {
      const parsed = parseEnv({ ...BASE, DEMO_MODE: "true", NODE_ENV: "production" });
      expect(parsed.DEMO_MODE).toBe(true);
      expect(parsed.NODE_ENV).toBe("production");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = previous;
    }
  });
});