// Single-command demo reset. Gates DEMO_MODE first so a misfire does
// nothing — no `db:reset`, no wipe. Then runs the four demo steps in
// order. This is the only allowed path to clear demo-academy and
// re-seed it between walkthroughs; running the four steps by hand
// works too but is what this command exists to remove.
//
// E2 — db:reset only drops and recreates the `public` schema
// (db/reset.ts); pg-boss's own `pgboss` schema lives outside it and
// survives untouched. Every tenant createTenant() or applyPreset()
// ever registered a sessions.generate schedule for (D2, E1) — across
// every demo:reset run before this one — leaves an orphaned
// pgboss.schedule row once its tenant is gone: 112 of them,
// confirmed, after two consecutive resets with no reconciliation
// step. db/deploy.ts's syncSessionGenerateSchedules is that
// reconciliation (it already runs on every real deploy, unschedules
// anything whose tenant isn't in the live trial/active set) — running
// `db:deploy` here, last, reuses it rather than re-implementing the
// same prune logic a second place. A reset is not actually a reset
// while stale cron rows outlive it.

import { spawnSync } from "node:child_process";
import { env } from "@/lib/env";

if (!env.DEMO_MODE) {
  console.error(
    "DEMO_MODE is not enabled — refusing demo:reset.\n" +
      "Set DEMO_MODE=true in your environment to permit this command.",
  );
  process.exit(1);
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  // Only short-circuit on failure. A successful step falls through to
  // the next one in the chain.
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

// Chain mirrors the runbook: reset the schema, re-seed demo-academy,
// provision the platform operator, reconcile pg-boss schedules against
// what actually exists after the reset. Each step short-circuits the
// chain on non-zero exit so a failure in one step doesn't run the next.
run("npx", ["tsx", "db/reset.ts"]);
run("npx", ["tsx", "scripts/seed-demo.ts"]);
run("npx", ["tsx", "scripts/seed-platform-user.ts"]);
run("npx", ["tsx", "db/deploy.ts"]);
