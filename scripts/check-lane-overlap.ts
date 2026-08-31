import { execFileSync } from "node:child_process";

// M2: warns, never blocks -- see docs/agent-lanes.md for why (the
// C-06 PR precedent: legitimate single-agent vertical slices
// correctly touch both db/migrations/ and app/, and a hard block
// would reject them). Only meaningful on a pull_request run, where
// GITHUB_BASE_REF names the branch this PR targets; on a push to
// main there's no "other side" to diff against.
const baseRef = process.env.GITHUB_BASE_REF;

if (!baseRef) {
  console.log("Not a pull_request run (no GITHUB_BASE_REF) -- skipping lane-overlap check.");
  process.exit(0);
}

let changed: string[];
try {
  const out = execFileSync("git", ["diff", "--name-only", `origin/${baseRef}...HEAD`], {
    encoding: "utf8",
  });
  changed = out.split("\n").filter(Boolean);
} catch (err) {
  console.log(`Could not diff against origin/${baseRef} -- skipping lane-overlap check.`, err);
  process.exit(0);
}

const touchesMigrations = changed.some((f) => f.startsWith("db/migrations/"));
const touchesUI = changed.some((f) => f.startsWith("app/") || f.startsWith("components/"));

if (touchesMigrations && touchesUI) {
  console.log(
    "::warning::This PR touches both db/migrations/ (schema lane) and app/ or components/ " +
      "(UI lane). docs/agent-lanes.md's default is one PR per lane, schema first. If this is a " +
      "small, genuinely single task with one consumer (see the persons.phone precedent), that's " +
      "fine as-is; if it's a larger vertical slice, consider splitting so each lane gets its own " +
      "reviewable diff.",
  );
} else {
  console.log("Lane check: no db/migrations + app|components overlap.");
}
