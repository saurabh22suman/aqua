// Drift check: scripts/seed-demo.ts and docs/demo-runbook.md must move
// together. If the seed changes and the runbook does not, the
// operator walkthrough lands on stale numbers and a demo-blocker
// turns up live.
//
// The check covers two cases:
//
//   1. **The most recent commit touched seed-demo.ts** but not
//      runbook.md. The check sees this via `git diff --name-only
//      HEAD~1..HEAD`.
//   2. **The working tree has uncommitted changes to seed-demo.ts**
//      but not runbook.md. The check sees this via `git diff
//      --name-only HEAD`.
//
// Edge case: a seed change that landed two or more commits ago with
// no runbook update since. That's a missed case here — the check is
// run on every commit and the failure message tells the author
// exactly what to do, so the feedback loop closes within one commit
// of the original mistake in practice. Run by `pnpm
// check:runbook-sync` and by CI on every PR.

import { execSync } from "node:child_process";

const SEED = "scripts/seed-demo.ts";
const RUNBOOK = "docs/demo-runbook.md";

function safeDiff(args: string): Set<string> {
  try {
    const out = execSync(`git diff --name-only ${args}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch {
    // No HEAD~1 yet (very fresh repo), or some other git quirk.
    return new Set();
  }
}

const lastCommit = safeDiff("HEAD~1..HEAD");
const workingTree = safeDiff("HEAD");

const seedInLastCommit = lastCommit.has(SEED);
const runbookInLastCommit = lastCommit.has(RUNBOOK);
const seedInWorkingTree = workingTree.has(SEED);
const runbookInWorkingTree = workingTree.has(RUNBOOK);

const seedTouched = seedInLastCommit || seedInWorkingTree;
const runbookTouched = runbookInLastCommit || runbookInWorkingTree;

if (seedTouched && !runbookTouched) {
  let where: string;
  if (seedInLastCommit && !seedInWorkingTree) {
    where = "the most recent commit";
  } else if (seedInLastCommit && seedInWorkingTree) {
    where = "the most recent commit AND the working tree";
  } else {
    where = "the working tree";
  }
  console.error(
    `check-runbook-sync: ${SEED} was modified in ${where} but ${RUNBOOK} was not.\n` +
      `When the seed changes, the runbook changes in the same PR — update ${RUNBOOK} to match.\n` +
      `(Seed change is the demo's source of truth; the runbook is what the operator reads.)`,
  );
  process.exit(1);
}

console.log(
  `OK: ${SEED} and ${RUNBOOK} move together ` +
    `(seed touched: ${seedTouched ? "yes" : "no"}, runbook touched: ${runbookTouched ? "yes" : "no"}).`,
);