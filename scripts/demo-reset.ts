// Single-command demo reset. Gates DEMO_MODE first so a misfire does
// nothing — no `db:reset`, no wipe. Then runs the three demo steps in
// order. This is the only allowed path to clear demo-academy and
// re-seed it between walkthroughs; running the three steps by hand
// works too but is what this command exists to remove.

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
// provision the platform operator. Each step short-circuits the chain
// on non-zero exit so a failure in step two doesn't run step three.
run("npx", ["tsx", "db/reset.ts"]);
run("npx", ["tsx", "scripts/seed-demo.ts"]);
run("npx", ["tsx", "scripts/seed-platform-user.ts"]);
