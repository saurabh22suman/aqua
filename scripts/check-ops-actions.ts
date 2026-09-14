import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listPlatformActionFiles,
  scanOpsActions,
  type OpsActionViolation,
} from "./lib/ops-action-scan";

// O-05 — CI scan: every mutating platform action must go through the
// audited opsAction pipeline (docs/ops-platform-design.md §5). The
// rule and its exemptions live in scripts/lib/ops-action-scan.ts; the
// known-bad fixture proof lives in
// tests/scanner-fixtures/ops-action-fixtures.test.ts.

const violations: OpsActionViolation[] = [];

for (const file of listPlatformActionFiles()) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  violations.push(...scanOpsActions(source, file));
}

if (violations.length > 0) {
  console.error(
    `check-ops-actions: ${violations.length} platform action(s) mutate without opsAction():\n` +
      violations
        .map((v) => `  ${v.file} → ${v.functionName}`)
        .join("\n") +
      `\n\nRoute the mutation through opsAction() (db/ops-action.ts) with a scope from the closed union, ` +
      `or add the function to EXEMPTIONS in scripts/lib/ops-action-scan.ts with a reason.`,
  );
  process.exit(1);
}

console.log("check-ops-actions: all platform actions are audited or exempt.");
