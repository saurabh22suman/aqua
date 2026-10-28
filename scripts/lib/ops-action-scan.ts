import { readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

// O-05 (docs/ops-platform-design.md §5) — the ops-action scan rule,
// shared by the CLI (scripts/check-ops-actions.ts) and its fixture
// test (tests/scanner-fixtures/ops-action-fixtures.test.ts) so the
// rule cannot drift between the two.
//
// Rule: every exported function in lib/actions/platform-*.ts must call
// opsAction(...) unless it is exempted here with a reason. Read-only
// actions, auth/session actions and credential-link issuance are the
// exemptions; anything else is a mutation that skipped the audited
// pipeline.

export const EXEMPTIONS: Record<string, string> = {
  "lib/actions/platform-activity.ts#listPlatformActivityAction":
    "read-only: lists platform_audit_log rows",
  "lib/actions/platform-activity.ts#listKnownActionsAction":
    "read-only: lists distinct audit actions",
  "lib/actions/platform-auth.ts#loginPlatformAction":
    "session issuance: audited by db/platform-auth.ts (platform.login)",
  "lib/actions/platform-auth.ts#verifyPlatformTotpAction":
    "session issuance: audited by db/platform-auth.ts (platform.login)",
  "lib/actions/platform-auth.ts#logoutPlatformAction":
    "session teardown: audited by db/platform-auth.ts (platform.logout)",
  "lib/actions/platform-auth.ts#platformAuthStatusAction":
    "read-only: resolves the current platform session",
  "lib/actions/platform-auth.ts#requireOpsAdminAction":
    "read-only: resolves the current platform role; no mutation",
  "lib/actions/platform-tax.ts#getTenantTaxConfigAction":
    "read-only: returns resolved GST rates per scope for the ops console",
};

// R03 (2026-10-13 role-workflow audit) — admin-guard exemptions. Every
// exported platform action that can mutate must call
// requireOpsAdminAction() (or a sibling that resolves the same
// session-validated platform role) unless it is read-only or part of
// sign-in/sign-out. Credential-link issuance is deliberately NOT
// exempt here: it mints a bearer credential and must stay admin-only.
export const ADMIN_GUARD_EXEMPTIONS: Record<string, string> = {
  "lib/actions/platform-activity.ts#listPlatformActivityAction":
    "read-only: lists platform_audit_log rows",
  "lib/actions/platform-activity.ts#listKnownActionsAction":
    "read-only: lists distinct audit actions",
  "lib/actions/platform-auth.ts#loginPlatformAction":
    "sign-in: runs before any platform role exists",
  "lib/actions/platform-auth.ts#verifyPlatformTotpAction":
    "sign-in: second-factor step before a full session exists",
  "lib/actions/platform-auth.ts#logoutPlatformAction":
    "sign-out: tears down the caller's own session",
  "lib/actions/platform-auth.ts#platformAuthStatusAction":
    "read-only: resolves the current platform session",
  "lib/actions/platform-auth.ts#requireOpsAdminAction":
    "the guard itself",
  "lib/actions/platform-tax.ts#getTenantTaxConfigAction":
    "read-only: returns resolved GST rates per scope for the ops console",
};

export type OpsActionViolation = {
  file: string;
  functionName: string;
};

export function scanOpsActions(
  source: string,
  filePath: string,
): OpsActionViolation[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: OpsActionViolation[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name) return;
    const exported =
      (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
    if (!exported) return;

    const functionName = node.name.text;
    if (EXEMPTIONS[`${filePath}#${functionName}`]) return;

    if (node.body && !containsOpsActionCall(node.body)) {
      violations.push({ file: filePath, functionName });
    }
  });

  return violations;
}

// An AST walk, not a text search: a comment mentioning opsAction()
// must not count as calling it (the known-bad fixture does exactly
// that, and that is what makes it a good fixture).
function containsOpsActionCall(body: ts.Node): boolean {
  return containsCallNamed(body, "opsAction");
}

function containsCallNamed(body: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

// R03 — second scan pass: every exported, non-exempt platform action
// must call requireOpsAdminAction() before it can reach a mutation.
// The scanner is the mechanical "every entry point" guarantee; the
// runtime re-check in db/ops-action.ts is the defence-in-depth layer.
export function scanPlatformAdminGuards(
  source: string,
  filePath: string,
): OpsActionViolation[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: OpsActionViolation[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name) return;
    const exported =
      (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
    if (!exported) return;

    const functionName = node.name.text;
    if (ADMIN_GUARD_EXEMPTIONS[`${filePath}#${functionName}`]) return;

    if (node.body && !containsCallNamed(node.body, "requireOpsAdminAction")) {
      violations.push({ file: filePath, functionName });
    }
  });

  return violations;
}

export function listPlatformActionFiles(root = process.cwd()): string[] {
  const dir = join(root, "lib", "actions");
  return readdirSync(dir)
    .filter((f) => f.startsWith("platform-") && f.endsWith(".ts"))
    .sort()
    .map((f) => join("lib", "actions", f));
}
