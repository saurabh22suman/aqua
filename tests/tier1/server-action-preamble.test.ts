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
});
