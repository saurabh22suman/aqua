import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listPlatformActionFiles,
  scanOpsActions,
  scanPlatformAdminGuards,
  type OpsActionViolation,
} from "./lib/ops-action-scan";

// O-05 — CI scan: every mutating platform action must go through the
// audited opsAction pipeline (docs/ops-platform-design.md §5). The
// rule and its exemptions live in scripts/lib/ops-action-scan.ts; the
// known-bad fixture proof lives in
// tests/scanner-fixtures/ops-action-fixtures.test.ts.
//
// R03 (2026-10-13 role-workflow audit) — second pass: every exported,
// non-exempt platform action must also call requireOpsAdminAction().
// Viewers are read-only; the guard resolves the platform role from the
// validated session, never from client input.

const opsViolations: OpsActionViolation[] = [];
const guardViolations: OpsActionViolation[] = [];

for (const file of listPlatformActionFiles()) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  opsViolations.push(...scanOpsActions(source, file));
  guardViolations.push(...scanPlatformAdminGuards(source, file));
}

if (opsViolations.length > 0) {
  console.error(
    `check-ops-actions: ${opsViolations.length} platform action(s) mutate without opsAction():\n` +
      opsViolations
        .map((v) => `  ${v.file} → ${v.functionName}`)
        .join("\n") +
      `\n\nRoute the mutation through opsAction() (db/ops-action.ts) with a scope from the closed union, ` +
      `or add the function to EXEMPTIONS in scripts/lib/ops-action-scan.ts with a reason.`,
  );
  process.exit(1);
}

if (guardViolations.length > 0) {
  console.error(
    `check-ops-actions: ${guardViolations.length} platform action(s) lack the admin guard:\n` +
      guardViolations
        .map((v) => `  ${v.file} → ${v.functionName}`)
        .join("\n") +
      `\n\nCall requireOpsAdminAction() (lib/actions/platform-auth.ts) before any mutation, ` +
      `or add the function to ADMIN_GUARD_EXEMPTIONS in scripts/lib/ops-action-scan.ts with a reason.`,
  );
  process.exit(1);
}

console.log("check-ops-actions: all platform actions are audited, admin-guarded or exempt.");
