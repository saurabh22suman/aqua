// Pure guard logic for db/reset.ts, split out so it's testable without
// touching Postgres. db/reset.ts drops and recreates the entire public
// schema — a bigger blast radius than anything DEMO_MODE was built to
// prevent. The demo:reset wrapper (scripts/demo-reset.ts) gates on
// DEMO_MODE, but db/reset.ts is also runnable standalone (`pnpm
// db:reset`, CI's own db:reset step) and must gate itself.

export type ResetGuardDecision = { allowed: true } | { allowed: false; reason: string };

export function evaluateResetGuard(input: {
  nodeEnv: "development" | "test" | "production";
  demoMode: boolean;
  argv: string[];
}): ResetGuardDecision {
  if (input.nodeEnv === "production") {
    return {
      allowed: false,
      reason:
        "db:reset refuses to run when NODE_ENV=production — this drops the entire public " +
        "schema unconditionally, regardless of DEMO_MODE or --i-understand.",
    };
  }

  const hasForceFlag = input.argv.includes("--i-understand");
  if (!input.demoMode && !hasForceFlag) {
    return {
      allowed: false,
      reason:
        "db:reset refuses to run unless DEMO_MODE=true or --i-understand is passed " +
        "explicitly — this drops the entire public schema.\n" +
        "Set DEMO_MODE=true for the demo flow, or pass --i-understand if you mean it " +
        "(e.g. CI, a scratch dev database).",
    };
  }

  return { allowed: true };
}

export function describeTarget(connectionString: string): { host: string; database: string } {
  const url = new URL(connectionString);
  return { host: url.hostname, database: url.pathname.replace(/^\//, "") };
}

export function confirmationMatches(input: string, database: string): boolean {
  return input.trim() === database;
}
