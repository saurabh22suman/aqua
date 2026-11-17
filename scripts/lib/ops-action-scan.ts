import { readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { createHash } from "node:crypto";

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
  "lib/actions/platform-login-link.ts#issueOwnerLoginLinkAction":
    "credential issuance: follow-up to route through opsAction when messaging lands (O-11); the token is single-purpose and short-lived",
  "lib/actions/platform-login-link.ts#issueOwnerResetLinkAction":
    "credential issuance: follow-up to route through opsAction when messaging lands (O-11); the token is single-purpose and short-lived",
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

// Exact reviewed audited reads, not file-wide or name-only exemptions.
// A change to a body, guard, or imported read boundary fails closed.
const REVIEWED_OPS_READS: Record<string, { digest: string; module: string; binding: string }> = {
  "lib/actions/platform-failed-notifications.ts#listFailedMessagesAction": { digest: "14e9b9305434cd20091c11165f4cf8b8043dd8b13eaf3ed6d579ffc8eb33e66d", module: "@/db/platform-messages", binding: "listFailedMessages" },
  "lib/actions/platform-jobs.ts#listDeadLetterJobsAction": { digest: "dd89a10b64aef301d8a7ca1c94bb0bd6f9421d9ab3188208ff5b1e1680411203", module: "@/db/platform-jobs", binding: "listDeadLetterJobs" },
  "lib/actions/platform-notifications.ts#listNotificationsNeedingAttentionAction": { digest: "aad43d64df7dd99141fcabcb246d42bd25bad24d62b2d189d0dd3bfc41834191", module: "@/db/platform-notifications", binding: "listNotificationsNeedingAttention" },
  "lib/actions/platform-operators-read.ts#listOperatorAccountsAction": { digest: "015fee845a8e4b40ca91eb57f962c98842dc76757a364af7330c173d9a8aad00", module: "@/db/platform-operators-read", binding: "listOperatorAccounts" },
  "lib/actions/platform-operators-read.ts#listOperatorSessionsAction": { digest: "54d6210d8bfb80cadd3e113cc97ae4ebf7d940ac566d3ea9c4714eb5ffae4aeb", module: "@/db/platform-operators-read", binding: "listOperatorSessions" },
};

function hasNamedImport(source: ts.SourceFile, module: string, name: string): boolean {
  return source.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === module && !s.importClause?.isTypeOnly && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.importClause.namedBindings.elements.some((e) => !e.isTypeOnly && e.name.text === name && (!e.propertyName || e.propertyName.text === name)));
}

function exportedActionBodies(sourceFile: ts.SourceFile): Array<{ name: string; body: ts.Node }> {
  const actions: Array<{ name: string; body: ts.Node }> = [];
  sourceFile.forEachChild((node) => {
    if (!ts.canHaveModifiers(node) || !ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) actions.push({ name: node.name.text, body: node.body });
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const value = declaration.initializer;
        if (ts.isIdentifier(declaration.name) && value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
          actions.push({ name: declaration.name.text, body: value.body });
        }
      }
    }
  });
  return actions;
}

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

  for (const action of exportedActionBodies(sourceFile)) {
    if (EXEMPTIONS[`${filePath}#${action.name}`]) continue;
    const reviewed = REVIEWED_OPS_READS[`${filePath}#${action.name}`];
    if (reviewed && ts.isFunctionDeclaration(action.body.parent) && hasNamedImport(sourceFile, "@/lib/auth/ops-operation", "runOpsGlobalRead") && hasNamedImport(sourceFile, reviewed.module, reviewed.binding) && !scanCheckedPlatformAdminGuards(source, filePath).some((v) => v.functionName === action.name)) {
      const printed = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, action.body.parent, sourceFile);
      if (createHash("sha256").update(printed).digest("hex") === reviewed.digest) continue;
    }
    if (!containsOpsActionCall(action.body)) {
      violations.push({ file: filePath, functionName: action.name });
    }
  }

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
    // A guard inside a nested function is not a guard of the exported
    // action itself; that nested function may never execute.
    if (ts.isFunctionLike(node)) return;
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

  for (const action of exportedActionBodies(sourceFile)) {
    if (ADMIN_GUARD_EXEMPTIONS[`${filePath}#${action.name}`]) continue;
    if (!containsCallNamed(action.body, "requireOpsAdminAction")) {
      violations.push({ file: filePath, functionName: action.name });
    }
  }

  return violations;
}

// A narrow structural proof for platform actions: the canonical imported
// guard must be awaited into a local, followed immediately by a terminating
// denial branch. It deliberately rejects unfamiliar control flow for review.
export function scanCheckedPlatformAdminGuards(source: string, filePath: string): OpsActionViolation[] {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bindings = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@/lib/actions/platform-auth") continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || statement.importClause?.isTypeOnly) continue;
    for (const item of named.elements) {
      if (!item.isTypeOnly && (item.propertyName?.text ?? item.name.text) === "requireOpsAdminAction") bindings.add(item.name.text);
    }
  }
  const preambles: Record<string, string> = {
    "lib/actions/platform-failed-notifications.ts#listFailedMessagesAction": "821ffc86b0499ced0978ee488d6064138a1cf7ea3b2db1216aabb5aa94d8f557",
    "lib/actions/platform-failed-notifications.ts#retryFailedNotificationAction": "3e6db1b112be454d9db3d5a53847bf555b2795fc05fbbe68dbc7de83ee0da3ee",
    "lib/actions/platform-failed-notifications.ts#dismissFailedNotificationAction": "f45cc146fccf2f05ef71650511b94c71c0c07c9d7ca966cfe03cf23622c35fe6",
    "lib/actions/platform-jobs.ts#listDeadLetterJobsAction": "98e0eba79c8255b6dd6446acc24d0c145baa6bdb6297d7ed28ab3e62a77dc68f",
    "lib/actions/platform-notifications.ts#listNotificationsNeedingAttentionAction": "b279b3b6513834dca92ad7566de283e7edc46fb41701ec8e0602e67bd14f9ba9",
    "lib/actions/platform-notifications.ts#resendUnknownNotificationAction": "4295eba32ec036808db6df6a9a6306bbcf0eb12ba9bdb8fe357f1fdba1e53aa2",
    "lib/actions/platform-notifications.ts#closeUnknownNotificationAction": "204c86fbb38be6ba27037f7616bee0311676dbccdf03ceb930f15ffed00e725e",
    "lib/actions/platform-operators-read.ts#listOperatorAccountsAction": "81a362ffe5be70dda0ac6747be4588d1ba628ed7563366572362a60d36608b6b",
    "lib/actions/platform-operators-read.ts#listOperatorSessionsAction": "9903b22b42f65e115dd787e8e756befd6a98f70bda0fd59daaa224eef0eb4ef4",
    "lib/actions/platform-operators-write.ts#revokeOperatorSessionAction": "4f34a1be32b707057e290effb3c96aa2d20164f16f45f9e76ab3f9ed3c961ae9",
    "lib/actions/platform-operators-write.ts#revokeAllOperatorSessionsAction": "7a326239257b10da6bd824ab041a5c657166b039d4ffa43869ff0dab48060a3b",
    "lib/actions/platform-operators-write.ts#setOperatorRoleAction": "0cf8ff2209dbbbf85ec19206c8b8547fe30c3036076cd552b615cf669f9ae49f",
    "lib/actions/platform-operators-write.ts#setOperatorStatusAction": "a1a07fadb6b82adb5b4adcb9bec3a2363f99f896ab94d9c0434493e9e6cf0683",
    "lib/actions/platform-tenant-plan.ts#assignTenantPlanAction": "b8596bac02e36a8f8fa87d91afbcbde680cb2d2028ad98aa6a10a51fdb37a4c7",
    "lib/actions/platform-tenant-trial.ts#setTenantTrialDeadlineAction": "e34f70c06005d0a17e9815b87a95910e28fc352e31793e6a2a06dad03d141ebc",
  };
  return exportedActionBodies(file).filter(({ name, body }) => {
    if (!ts.isBlock(body)) return true;
    const statements = body.statements;
    for (let i = 0; i + 1 < statements.length; i++) {
      const declaration = statements[i];
      if (!ts.isVariableStatement(declaration) || !(declaration.declarationList.flags & ts.NodeFlags.Const) || declaration.declarationList.declarations.length !== 1) continue;
      const item = declaration.declarationList.declarations[0]!;
      const init = item.initializer;
      if (!ts.isIdentifier(item.name) || !init || !ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression) || !ts.isIdentifier(init.expression.expression) || !bindings.has(init.expression.expression.text) || init.expression.arguments.length !== 0) continue;
      const guardName = init.expression.expression.text;
      const owner = body.parent;
      if (ts.isFunctionLike(owner) && owner.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === guardName)) continue;
      let unsafeEarlier = false;
      for (const earlier of statements.slice(0, i)) {
        const visit = (node: ts.Node): void => {
          if (ts.isFunctionLike(node)) return;
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === guardName) unsafeEarlier = true;
          if (ts.isCallExpression(node)) {
            const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
            if (!["safeParse", "parse", "recordOpsRejection", "recordOpsMutationTrace"].includes(name)) unsafeEarlier = true;
          }
          ts.forEachChild(node, visit);
        };
        visit(earlier);
      }
      if (unsafeEarlier) {
        // The real forms perform normalization and invalid-input auditing
        // before the guard. Pin those exact reviewed AST statements per
        // function; a change requires review, not a generic method exemption.
        const printer = ts.createPrinter({ removeComments: true });
        const prefix = statements.slice(0, i).map((s) => printer.printNode(ts.EmitHint.Unspecified, s, file)).join("\n");
        const digest = createHash("sha256").update(prefix).digest("hex");
        if (preambles[`${filePath}#${name}`] !== digest) continue;
      }
      const check = statements[i + 1];
      if (!ts.isIfStatement(check) || check.elseStatement || !ts.isBinaryExpression(check.expression)) continue;
      const condition = check.expression;
      if (!ts.isPropertyAccessExpression(condition.left) || !ts.isIdentifier(condition.left.expression) || condition.left.expression.text !== item.name.text || condition.left.name.text !== "kind" || !ts.isStringLiteral(condition.right)) continue;
      const denial = (condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken && condition.right.text === "ok") || (condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && condition.right.text === "error");
      const branch = ts.isBlock(check.thenStatement) ? check.thenStatement.statements : [check.thenStatement];
      const last = branch[branch.length - 1];
      if (!denial || !last || !(ts.isReturnStatement(last) || ts.isThrowStatement(last))) continue;
      let unsafeDenial = false;
      const visitDenial = (node: ts.Node): void => {
        if (ts.isFunctionLike(node)) { unsafeDenial = true; return; }
        if (ts.isCallExpression(node)) {
          const callName = ts.isIdentifier(node.expression) ? node.expression.text : "";
          if (callName === "recordOpsRejection" || callName === "recordOpsMutationTrace") {
            const trusted = file.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === "@/lib/auth/ops-operation" && !s.importClause?.isTypeOnly && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.importClause.namedBindings.elements.some((e) => !e.isTypeOnly && e.name.text === callName && (!e.propertyName || e.propertyName.text === callName)));
            if (!trusted) unsafeDenial = true;
          } else if (callName === "refusalText") {
            const helpers = file.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "refusalText");
            const helper = helpers[0];
            if (helpers.length !== 1 || !helper?.body || helper.body.statements.length !== 1 || !ts.isReturnStatement(helper.body.statements[0]!)) unsafeDenial = true;
            if (helper?.body) {
              const pure = (n: ts.Node): void => {
                if (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isAwaitExpression(n) || ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) unsafeDenial = true;
                ts.forEachChild(n, pure);
              };
              pure(helper.body);
            }
          } else unsafeDenial = true;
        }
        ts.forEachChild(node, visitDenial);
      };
      visitDenial(check.thenStatement);
      if (!unsafeDenial) return false;
    }
    return true;
  }).map(({ name }) => ({ file: filePath, functionName: name }));
}

export function listPlatformActionFiles(root = process.cwd()): string[] {
  const dir = join(root, "lib", "actions");
  return readdirSync(dir)
    .filter((f) => f.startsWith("platform-") && f.endsWith(".ts"))
    .sort()
    .map((f) => join("lib", "actions", f));
}
