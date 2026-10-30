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

    if (
      node.body &&
      !containsOpsActionCall(node.body) &&
      !acceptsBoundaryRead(node.body)
    ) {
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

// Rev4 read boundary, bounded and explicit. Accepted forms: (1) a
// top-level `return runOpsRead(...)/runOpsGlobalRead(...)`; (2) one
// top-level `const x = await boundary(...)`, a fixed top-level null
// guard and `return x`. A READ boundary call in a nested callable,
// branch, loop, second assignment or void expression does not satisfy
// the rule. This is not a general control-flow proof; the runtime
// opsAction check remains the mutation boundary.
//
// The REFUSAL/TRACE helpers are counted separately. A read that first
// records a pre-read refusal (lib/actions/platform-tax.ts records the
// invalid-tenant refusal before it reads) is still a read, and that
// refusal is not a second read. A refusal helper call is allowed here
// only as a statement of THIS function — never inside a nested callable,
// where it would be a decoy.
function acceptsBoundaryRead(body: ts.Node): boolean {
  if (!ts.isBlock(body)) return false;
  const readCalls: ts.CallExpression[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      READ_BOUNDARY_CALLS.has(node.expression.text)
    ) {
      readCalls.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(body);
  // Exactly one READ boundary call, at a top-level accepted position. A
  // decoy in a branch, loop, nested callable or second assignment fails
  // this.
  if (readCalls.length !== 1) return false;
  if (!refusalsAreOwnStatements(body)) return false;
  const call = readCalls[0]!;
  const statements = body.statements;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (ts.isReturnStatement(statement) && statement.expression === call) {
      return true;
    }
    if (!ts.isVariableStatement(statement)) continue;
    if (statement.declarationList.declarations.length !== 1) continue;
    const declaration = statement.declarationList.declarations[0]!;
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
    if (
      !ts.isAwaitExpression(declaration.initializer) ||
      declaration.initializer.expression !== call
    ) {
      continue;
    }
    const name = declaration.name.text;
    const guard = statements[index + 1];
    const returned = statements[index + 2];
    if (!guard || !returned || !ts.isIfStatement(guard)) return false;
    const test = guard.expression;
    const nullCheck =
      (ts.isBinaryExpression(test) &&
        test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(test.left) &&
        test.left.text === name &&
        test.right.kind === ts.SyntaxKind.NullKeyword) ||
      (ts.isPrefixUnaryExpression(test) &&
        test.operator === ts.SyntaxKind.ExclamationToken &&
        ts.isIdentifier(test.operand) &&
        test.operand.text === name);
    if (!nullCheck) return false;
    const branch = guard.thenStatement;
    const abort =
      ts.isBlock(branch) && branch.statements.length === 1
        ? branch.statements[0]!
        : branch;
    if (!ts.isThrowStatement(abort) && !ts.isReturnStatement(abort)) return false;
    if (
      !ts.isReturnStatement(returned) ||
      !returned.expression ||
      !ts.isIdentifier(returned.expression) ||
      returned.expression.text !== name
    ) {
      return false;
    }
    return true;
  }
  return false;
}

// The READ boundary helpers: they perform the audited read.
const READ_BOUNDARY_CALLS = new Set(["runOpsRead", "runOpsGlobalRead"]);

// The REFUSAL/TRACE helpers: they record a refusal, a refusal outcome or
// a thrown failure. They never perform the read, so they are counted
// separately by the read-shape rule.
const REFUSAL_BOUNDARY_CALLS = new Set([
  "recordOpsRejection",
  "recordOpsMutationTrace",
  "recordOpsThrownFailure",
]);

// Every refusal helper call must be a statement of the function itself.
// A call inside a nested callable (an arrow or function expression) is a
// decoy: the function would look audited without ever recording the
// refusal.
function refusalsAreOwnStatements(body: ts.Node): boolean {
  let ok = true;
  const visit = (node: ts.Node): void => {
    if (!ok) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      REFUSAL_BOUNDARY_CALLS.has(node.expression.text) &&
      isInsideNestedCallable(node, body)
    ) {
      ok = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return ok;
}

function isInsideNestedCallable(node: ts.Node, body: ts.Node): boolean {
  let current = node.parent;
  while (current && current !== body) {
    if (
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
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

// Packet 04b — call coverage. A union member must be the FIRST string
// argument of an approved boundary call in a wiring file. Comments, bare
// strings and unrelated literals do not count. This is a call-coverage rule,
// not general control-flow security proof.
const BOUNDARY_CALLS = new Set([
  "runOpsRead",
  "runOpsGlobalRead",
  "recordOpsRejection",
  "recordOpsMutationTrace",
  "recordOpsThrownFailure",
]);

// The registry members are read with the TypeScript AST, NOT with a text
// search. A text search for the first ";" after the type declaration ends
// at the first semicolon in a COMMENT — and a registry with a comment
// like "One name per operation;" then looks like a four-member registry,
// while the coverage check passes VACUOUSLY. The AST cannot be fooled by
// a comment.
export function extractOperationMembers(unionSource: string): string[] {
  const sourceFile = ts.createSourceFile(
    "lib/auth/ops-operation.ts",
    unionSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const members: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (statement.name.text !== "OpsBoundaryOperation") continue;
    const type = statement.type;
    if (!ts.isUnionTypeNode(type)) continue;
    for (const member of type.types) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        members.push(member.literal.text);
      }
    }
  }
  return [...new Set(members)];
}

export function scanOperationCoverage(
  unionSource: string,
  sources: { path: string; source: string }[],
): string[] {
  const used = new Set<string>();
  for (const file of sources) {
    if (file.path === "lib/auth/ops-operation.ts") continue;
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        BOUNDARY_CALLS.has(node.expression.text)
      ) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) used.add(first.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return extractOperationMembers(unionSource).filter(
    (member) => !used.has(member),
  );
}

export function listOpsPageFiles(root = process.cwd()): string[] {
  const dir = join(root, "app", "(platform)", "ops");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .sort()
    .map((file) => join("app", "(platform)", "ops", file));
}

// The SERVER entry files of the Ops console: pages, layouts and route
// handlers. A client island is not an entry boundary.
export function listOpsEntryFiles(root = process.cwd()): string[] {
  const dir = join(root, "app", "(platform)", "ops");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => {
      const base = file.slice(file.lastIndexOf("/") + 1);
      return OPS_ENTRY_FILE_NAMES.has(base);
    })
    .sort()
    .map((file) => join("app", "(platform)", "ops", file));
}

// ---------------------------------------------------------------------------
// The Ops ENTRY registry.
//
// Every SERVER entry file under app/(platform)/ops/ — a page, a layout or
// a route handler — must either resolve its reads through the operation
// boundary or be classified here WITH a reason.
//
// The registry, not this scanner, decides what is not an operation. A new
// Ops page that is neither instrumented nor classified FAILS the check, so
// a new boundary cannot appear unclassified and unrecorded.
//
// The reasons are written out here, in the source, on purpose: a reader
// must be able to see WHICH entries are not operations and why, without
// reading a second document.
// ---------------------------------------------------------------------------
export const OPS_ENTRY_CLASSIFICATIONS: Record<string, string> = {
  "app/(platform)/ops/leads/new/page.tsx":
    "no platform data is read: the form's fields are validated by the platform_lead.create action",
  "app/(platform)/ops/login/page.tsx":
    "sign-in page: it reads the caller's own session state only, and no platform data exists before the session does",
  "app/(platform)/ops/verify/page.tsx":
    "second-factor page: it reads the caller's own session state only, and no platform data exists before the session does",
  "app/(platform)/ops/tenants/[tenantId]/tax/page.tsx":
    "delegates to the instrumented tax.read action (lib/actions/platform-tax.ts); the page reads no data itself",
  "app/(platform)/ops/api/whatsapp-auth/route.ts":
    "pre-auth sign-in route: it refuses every ops request before any data is read, and the bounded pre-auth events belong to the auth lane",
};

// The server entry files of the Ops console. A client component is not an
// entry boundary: it renders what the server gave it.
const OPS_ENTRY_FILE_NAMES = new Set(["page.tsx", "layout.tsx", "route.ts"]);

export function isOpsEntryFile(filePath: string): boolean {
  if (!filePath.startsWith(join("app", "(platform)", "ops"))) return false;
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  return OPS_ENTRY_FILE_NAMES.has(base);
}

// The entry files that resolve their reads through the boundary and are not
// classified. An empty result means every Ops entry file is accounted for.
export function scanOpsEntryCoverage(
  sources: { path: string; source: string }[],
): string[] {
  const uncovered: string[] = [];
  for (const file of sources) {
    if (!isOpsEntryFile(file.path)) continue;
    if (file.source.startsWith('"use client"')) continue;
    if (OPS_ENTRY_CLASSIFICATIONS[file.path]) continue;
    if (containsAnyBoundaryCall(file.source, file.path)) continue;
    uncovered.push(file.path);
  }
  return uncovered.sort();
}

function containsAnyBoundaryCall(source: string, filePath: string): boolean {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      BOUNDARY_CALLS.has(node.expression.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
