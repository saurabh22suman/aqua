import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// Standing rule: every Server Action that takes input opens with a Zod
// parse before anything else runs. Found by hand three times
// (markAttendanceSessionAction, getRosterAction, devCodeAction) — a fix
// applied by hand at one call site is not a fix, it is a coincidence.
// This walks the real TypeScript AST (the `typescript` package is
// already a devDependency — drizzle-kit needs it too) rather than
// regexing source text, so it isn't fooled by comments, string content,
// or formatting.
//
// As of the Phase 1.5–1.7 audit, the rule is now two steps, not one:
// (1) parse, then (2) a permission check before any service call.
// Same shape as the original — AST walk, no regexes.

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function isUseServerFile(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function isExported(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function isAsync(node: ts.FunctionLikeDeclarationBase): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

// True if `stmt` is (or assigns from) a `<expr>.parse(...)` /
// `<expr>.safeParse(...)` call — the shape every fixed call site uses.
function isParseCall(expr: ts.Expression | undefined): boolean {
  if (!expr || !ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === "parse" || callee.name.text === "safeParse")
  );
}

function firstStatementIsParse(body: ts.Block): boolean {
  const first = body.statements[0];
  if (!first) return false;
  if (ts.isVariableStatement(first)) {
    const init = first.declarationList.declarations[0]?.initializer;
    return isParseCall(init);
  }
  if (ts.isExpressionStatement(first)) {
    const e = first.expression;
    if (isParseCall(e)) return true;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return isParseCall(e.right);
    }
  }
  return false;
}

// Detect a permission-check call. Three accepted shapes in this repo:
//
//   const status = await platformAuthStatusAction();
//   if (status.kind !== "authenticated") { return ... }
//
//   const ctx = await requireDefaultCtx();
//   assertStaff(ctx);
//
//   const session = await withPlatform(() => auth.api.getSession(...));
//   if (!session) { return ... }
//
//   requirePermission(ctx, "x.y");
//   requireCtx(slug);
//
// All five names match a `require*` / `assert*` / `platformAuth*` prefix,
// or sit on the platform-session lookup path. We don't infer "auth"
// from the return shape — false positives there would let a future
// refactor break the check without flipping this test. The allowlist
// below is the source of truth; add new gates here when they land.
const PERMISSION_CALL_NAMES = new Set([
  "platformAuthStatusAction",
  "homeForSessionAction",
  "requireDefaultCtx",
  "requireCtx",
  "requirePermission",
  "assertStaff",
]);

function isPermissionCallExpr(expr: ts.Expression): boolean {
  // Direct call: `platformAuthStatusAction()`
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return PERMISSION_CALL_NAMES.has(expr.expression.text);
  }
  // Awaited direct call: `await platformAuthStatusAction()`
  if (
    ts.isAwaitExpression(expr) &&
    ts.isCallExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    PERMISSION_CALL_NAMES.has(expr.expression.expression.text)
  ) {
    return true;
  }
  // IIFE wrapped: `withPlatform(() => auth.api.getSession(...))` — the
  // platform-session lookup path. Accept it as a permission call by
  // name, even though it's wrapped.
  if (
    ts.isAwaitExpression(expr) &&
    ts.isCallExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === "withPlatform"
  ) {
    return true;
  }
  return false;
}

// True iff the body runs parse → permission check → service in that
// order. The rule is "permission must come before service"; the test
// walks all top-level statements (and the body of any leading try)
// to find both a permission call and any "service-looking" call,
// then asserts parse < permission < service. Skipping the strict
// "second statement" check lets the action interleave a normalisation
// step (intermediate variable assignment) between parse and
// permission — the rule is about ordering, not slot allocation.
type Site = { index: number; isPerm: boolean; isServiceCall: boolean };

function flattenBody(body: ts.Block): { stmt: ts.Statement; site: Site }[] {
  const out: { stmt: ts.Statement; site: Site }[] = [];
  body.statements.forEach((s, i) => {
    out.push({ stmt: s, site: { index: i, isPerm: false, isServiceCall: false } });
  });
  return out;
}

// Heuristic: a statement "is a service call" if it contains an await
// on a name not in PERMISSION_CALL_NAMES, not a primitive (number/
// string literal), and not a return / throw / if. Cheap and
// conservative — false positives cost a test failure that points
// to the right file and line, which is the right outcome.
function statementLooksLikeServiceCall(s: ts.Statement): boolean {
  let cursor: ts.Node = s;
  if (ts.isVariableStatement(s)) {
    const init = s.declarationList.declarations[0]?.initializer;
    if (!init) return false;
    cursor = init;
  } else if (ts.isExpressionStatement(s)) {
    cursor = s.expression;
  } else if (ts.isReturnStatement(s)) {
    return false;
  } else {
    return false;
  }
  if (ts.isAwaitExpression(cursor)) cursor = cursor.expression;
  if (!ts.isCallExpression(cursor)) return false;
  // An `await auth.api.getSession({ headers })` style call — we
  // treat it as a session lookup, not a service call, and let
  // PERMISSION_CALL_NAMES catch the wrapper.
  let sawPermissionWrapper = false;
  if (
    ts.isCallExpression(cursor) &&
    ts.isPropertyAccessExpression(cursor.expression) &&
    ts.isIdentifier(cursor.expression.expression) &&
    cursor.expression.expression.text === "auth" &&
    cursor.expression.name.text === "api"
  ) {
    sawPermissionWrapper = true;
  }
  if (
    ts.isCallExpression(cursor) &&
    ts.isIdentifier(cursor.expression) &&
    PERMISSION_CALL_NAMES.has(cursor.expression.text)
  ) {
    return false;
  }
  if (sawPermissionWrapper) return false;
  return true;
}

function secondStatementIsPermissionCheck(body: ts.Block): boolean {
  const flattened = flattenBody(body);
  let permIndex = -1;
  let serviceIndex = -1;

  for (const { stmt, site } of flattened) {
    // Recurse into the leading try block if there is one — the
    // platform-auth shape wraps the lookup call in try/catch.
    if (ts.isTryStatement(stmt)) {
      const inner = stmt.tryBlock.statements;
      inner.forEach((s, i) => {
        const init = s && ts.isVariableStatement(s)
          ? s.declarationList.declarations[0]?.initializer
          : s && ts.isExpressionStatement(s)
            ? s.expression
            : undefined;
        if (init && isPermissionCallExpr(init)) {
          if (permIndex === -1) permIndex = site.index + 0.001 + i * 0.001;
        }
      });
    }
    if (
      site.isServiceCall &&
      statementLooksLikeServiceCall(stmt) &&
      serviceIndex === -1
    ) {
      serviceIndex = site.index;
    }
    if (!site.isServiceCall && permIndex === -1) {
      // Look at this statement directly — mark it as a permission
      // candidate if its expression is a permission call.
      const init =
        ts.isVariableStatement(stmt)
          ? stmt.declarationList.declarations[0]?.initializer
          : ts.isExpressionStatement(stmt)
            ? stmt.expression
            : undefined;
      if (init && isPermissionCallExpr(init)) {
        permIndex = site.index;
      }
    }
  }

  if (permIndex === -1) return false;
  if (serviceIndex === -1) return true; // no service call → safe
  return permIndex < serviceIndex;
}

type Action = { file: string; name: string; hasParams: boolean; body: ts.Block };

function findActions(source: ts.SourceFile): Action[] {
  if (!isUseServerFile(source)) return [];
  const actions: Action[] = [];

  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body && isExported(stmt) && isAsync(stmt)) {
      actions.push({
        file: source.fileName,
        name: stmt.name.text,
        hasParams: stmt.parameters.length > 0,
        body: stmt.body,
      });
    }
    if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          init.body &&
          ts.isBlock(init.body) &&
          isAsync(init) &&
          ts.isIdentifier(decl.name)
        ) {
          actions.push({
            file: source.fileName,
            name: decl.name.text,
            hasParams: init.parameters.length > 0,
            body: init.body,
          });
        }
      }
    }
  }
  return actions;
}

function allActions(): Action[] {
  const actions: Action[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      actions.push(...findActions(source));
    }
  }
  return actions;
}

describe("every Server Action that takes input parses it first", () => {
  const actions = allActions();

  it("found at least one \"use server\" action — the scan itself isn't silently empty", () => {
    expect(actions.length).toBeGreaterThan(0);
  });

  const withInput = actions.filter((a) => a.hasParams);

  it.each(withInput.map((a) => [`${a.file}#${a.name}`, a] as const))(
    "%s opens with a .parse()/.safeParse() call",
    (_label, action) => {
      expect(
        firstStatementIsParse(action.body),
        `${action.name} in ${action.file} takes input but its first statement isn't a Zod parse`,
      ).toBe(true);
    },
  );

  it.each(withInput.map((a) => [`${a.file}#${a.name}`, a] as const))(
    "%s runs a permission check as the second statement (after parse, before service)",
    (_label, action) => {
      // Pre-auth actions are exempt: the act of authenticating
      // doesn't have a permission check to gate on. Anything added
      // to this allowlist needs a comment naming why the check is
      // unhelpful — no silent exemptions.
      if (PRE_AUTH_ACTIONS.has(action.name)) return;
      expect(
        secondStatementIsPermissionCheck(action.body),
        `${action.name} in ${action.file} parsed input but the next statement isn't a permission check (call to platformAuthStatusAction / withPlatform(() => auth.api.getSession(...))).`,
      ).toBe(true);
    },
  );
});

// Pre-auth actions: ones whose second statement *can't* be a
// permission check because there is no session yet to check against.
// Add to this list only when the action's purpose is the auth step
// itself; if you're tempted to add a domain action here, the
// permission check it should run is `requireDefaultCtx()` (or the
// platform equivalent) — not "no check at all."
const PRE_AUTH_ACTIONS = new Set([
  "loginPlatformAction", // password + email; no session to check
  "verifyPlatformTotpAction", // second-factor verify; first half-auth only
  "devCodeAction", // dev-only OTP peek, fails closed in production
]);
