import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listOpsEntryFiles,
  listOpsPageFiles,
  listPlatformActionFiles,
  scanOperationCoverage,
  scanOpsActions,
  scanOpsEntryCoverage,
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
//
// Packet 04b — third pass: every operation name in the registry
// (lib/auth/ops-operation.ts) must have a real boundary CALL SITE, and
// every Ops server entry file must be instrumented or classified.

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
      `return a read through runOpsRead()/runOpsGlobalRead() (lib/auth/ops-operation.ts), ` +
      `or add the function to EXEMPTIONS in scripts/lib/ops-action-scan.ts with a reason.`,
  );
  process.exit(1);
}

const unionFile = "lib/auth/ops-operation.ts";
const unionSource = readFileSync(join(process.cwd(), unionFile), "utf8");
const coverageSources = [
  ...listPlatformActionFiles().map((file) => ({
    path: file,
    source: readFileSync(join(process.cwd(), file), "utf8"),
  })),
  ...listOpsPageFiles().map((file) => ({
    path: file,
    source: readFileSync(join(process.cwd(), file), "utf8"),
  })),
  ...listOpsEntryFiles()
    .filter((file) => !file.endsWith(".tsx"))
    .map((file) => ({
      path: file,
      source: readFileSync(join(process.cwd(), file), "utf8"),
    })),
];
const missingOperations = scanOperationCoverage(unionSource, coverageSources);

const entrySources = listOpsEntryFiles().map((file) => ({
  path: file,
  source: readFileSync(join(process.cwd(), file), "utf8"),
}));
const uncoveredEntries = scanOpsEntryCoverage(entrySources);

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

if (missingOperations.length > 0) {
  console.error(
    `check-ops-actions: ${missingOperations.length} operation name(s) have no wiring call site:\n` +
      missingOperations.map((name) => `  ${name}`).join("\n") +
      `\n\nCall a boundary helper with the operation name ` +
      `(runOpsRead/runOpsGlobalRead/recordOpsRejection/recordOpsMutationTrace/recordOpsThrownFailure) ` +
      `or remove it from OpsBoundaryOperation (lib/auth/ops-operation.ts).`,
  );
  process.exit(1);
}

if (uncoveredEntries.length > 0) {
  console.error(
    `check-ops-actions: ${uncoveredEntries.length} Ops entry file(s) are neither instrumented nor classified:\n` +
      uncoveredEntries.map((file) => `  ${file}`).join("\n") +
      `\n\nResolve the file's reads through the operation boundary ` +
      `(runOpsRead/runOpsGlobalRead), or add it to OPS_ENTRY_CLASSIFICATIONS in ` +
      `scripts/lib/ops-action-scan.ts with the reason it is not an operation.`,
  );
  process.exit(1);
}

console.log(
  "check-ops-actions: all platform actions are audited, admin-guarded or exempt; " +
    "every operation name has a boundary call site; every Ops entry file is instrumented or classified.",
);
