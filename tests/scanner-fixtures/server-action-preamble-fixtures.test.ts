import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// Fixture-based regression for the server-action-preamble ordering rule.
//
// Why this file exists:
//   The production checker in tests/tier1/server-action-preamble.test.ts
//   walks the real source tree (lib/, app/) and asserts every action
//   opens with a parse() call followed by a requirePermission(...) call
//   before any service-level side effect. The audit caught a class of
//   bug where the "permission-call" allowlist included requireDefaultCtx,
//   so the checker was satisfied by ctx construction alone — a real
//   requirePermission could then slip past the order check after a
//   service call. The fix removes requireDefaultCtx from that allowlist.
//
//   This file is the focused regression test for the RULE itself, not
//   the application's use of the rule. It exercises inline fixtures
//   (the same source shape as a real Server Action) and applies the
//   focused checker to them. The fixtures under
//   tests/scanner-fixtures/fixtures/ are now consumed by the
//   page-guard-scan and action-permission-scan tests in
//   tests/tier1/ (the D2 attack tests) and no longer carry the
//   parse → permission → service shape; the inline cases below
//   preserve that coverage here.
//
// What is in scope:
//   1. The mutation case the fix is intended to catch: an action
//      whose requirePermission moved after a service call must be
//      flagged.
//   2. The "requireDefaultCtx alone" case the audit caught:
//      ctx construction used to satisfy the rule by itself. The
//      rule under test pins this is NOT a permission check.
//
// This checker is deliberately narrower than the one in tests/tier1/:
//   - No try-block recursion (the production checker has it because
//     platform-auth actions wrap the auth lookup in try/catch; the
//     fixtures don't need it).
//   - No PERMISSION_CALL_NAMES allowlist — the rule under test is
//     specifically that requireDefaultCtx does NOT count, so a
//     fixture that uses only requireDefaultCtx to "satisfy" the rule
//     must fail.
//   - Built-ins (String, Number, revalidatePath, formData.get, …) are
//     excluded from the service-call set, identical to the production
//     code, so post-parse normalisation doesn't trip the check.
//
// If a future change to the production checker narrows or broadens the
// rule, this file documents what the rule IS, so the two stay in
// lockstep when reviewed side-by-side.

const PERMISSION_CALL_NAMES = new Set([
  "platformAuthStatusAction",
  "homeForSessionAction",
  "requirePermission",
]);

const NON_SERVICE_NAMES = new Set([
  "String", "Number", "Boolean", "Object", "Array", "JSON",
  "Math", "Date", "Set", "Map", "Promise", "Symbol", "Error",
  "revalidatePath", "revalidateTag", "redirect", "notFound",
  "get", "getAll", "has", "entries", "keys", "values",
  // The proposed fix (tests/tier1/server-action-preamble.test.ts):
  // requireDefaultCtx / requireCtx no longer count as permission
  // checks, but ctx construction is also NOT a service-level side
  // effect — it sits in the same category as revalidatePath: a
  // platform-level lookup the action legitimately does before the
  // real service call. Without this entry, every action that calls
  // requireDefaultCtx would fail the order check after the rule is
  // tightened, which is exactly the regression the proposal is meant
  // to avoid.
  "requireDefaultCtx",
  "requireCtx",
]);

function isPermissionCall(expr: ts.Expression | undefined): boolean {
  if (!expr) return false;
  const e = ts.isAwaitExpression(expr) ? expr.expression : expr;
  if (!ts.isCallExpression(e)) return false;
  if (!ts.isIdentifier(e.expression)) return false;
  return PERMISSION_CALL_NAMES.has(e.expression.text);
}

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

  // Exclude parse calls — same shape the production checker filters.
  if (
    ts.isPropertyAccessExpression(cursor.expression) &&
    (cursor.expression.name.text === "parse" ||
      cursor.expression.name.text === "safeParse")
  ) {
    return false;
  }
  if (
    ts.isCallExpression(cursor) &&
    ts.isIdentifier(cursor.expression) &&
    PERMISSION_CALL_NAMES.has(cursor.expression.text)
  ) {
    return false;
  }
  if (
    ts.isCallExpression(cursor) &&
    ts.isIdentifier(cursor.expression) &&
    NON_SERVICE_NAMES.has(cursor.expression.text)
  ) {
    return false;
  }
  return true;
}

function firstStatementIsParse(body: ts.Block): boolean {
  const first = body.statements[0];
  if (!first || !ts.isVariableStatement(first)) return false;
  const init = first.declarationList.declarations[0]?.initializer;
  if (!init) return false;
  if (!ts.isCallExpression(init)) return false;
  const callee = init.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === "parse" || callee.name.text === "safeParse")
  );
}

function checkFixture(source: string): { ok: true } | { ok: false; reason: string } {
  const sf = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);

  // The fixture declares exactly one exported async function. Find it.
  let fnBody: ts.Block | undefined;
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name &&
      stmt.body &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      fnBody = stmt.body;
      break;
    }
  }
  if (!fnBody) return { ok: false, reason: "no exported async function found" };

  if (!firstStatementIsParse(fnBody)) {
    return { ok: false, reason: "first statement is not parse()" };
  }

  let permIndex = -1;
  let serviceIndex = -1;
  fnBody.statements.forEach((s, i) => {
    if (permIndex === -1) {
      const init = ts.isVariableStatement(s)
        ? s.declarationList.declarations[0]?.initializer
        : ts.isExpressionStatement(s)
          ? s.expression
          : undefined;
      if (isPermissionCall(init)) permIndex = i;
    }
    if (serviceIndex === -1 && statementLooksLikeServiceCall(s)) {
      serviceIndex = i;
    }
  });

  if (permIndex === -1) {
    return { ok: false, reason: "no permission call found in body" };
  }
  if (serviceIndex === -1) return { ok: true };
  if (permIndex < serviceIndex) return { ok: true };
  return {
    ok: false,
    reason: `permission call at statement ${permIndex} sits AFTER service call at statement ${serviceIndex}`,
  };
}

describe("scanner fixtures — server-action-preamble ordering rule", () => {
  it("flags parse → service → requirePermission (the audit's bug shape)", () => {
    // The mutation proof from the original audit: parse, ctx
    // construction, then a service call, then the permission
    // check at the bottom. The permission check is too late —
    // the service side effect already ran. The order rule
    // must flag this.
    const src = `
"use server";
import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
const inputSchema = z.object({ x: z.string() });
export async function mutated(rawInput: unknown): Promise<void> {
  const parsed = inputSchema.parse(rawInput);
  const ctx = await requireDefaultCtx();
  await doServiceCall();
  requirePermission(ctx, "members.read");
}
async function doServiceCall(): Promise<void> {}
`;
    const verdict = checkFixture(src);
    expect(verdict.ok, JSON.stringify(verdict)).toBe(false);
  });

  it("flags parse → requireDefaultCtx → service (no requirePermission at all)", () => {
    // The audit's exact bug: requireDefaultCtx used to be in the
    // permission-call allowlist, so a body that called only
    // requireDefaultCtx (no requirePermission) passed the
    // production checker. The order rule pins this: ctx
    // construction alone is not a permission check.
    const src = `
"use server";
import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
const inputSchema = z.object({ x: z.string() });
export async function onlyCtx(rawInput: unknown): Promise<void> {
  const parsed = inputSchema.parse(rawInput);
  const ctx = await requireDefaultCtx();
  await doServiceCall();
}
async function doServiceCall(): Promise<void> {}
`;
    const verdict = checkFixture(src);
    expect(verdict.ok, JSON.stringify(verdict)).toBe(false);
  });

  it("passes parse → requirePermission → service (the correct order)", () => {
    // Positive control: a well-formed action must pass. If a
    // future change to the order rule accidentally flags this
    // shape, this case flips red.
    const src = `
"use server";
import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
const inputSchema = z.object({ x: z.string() });
export async function wellFormed(rawInput: unknown): Promise<void> {
  const parsed = inputSchema.parse(rawInput);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  await doServiceCall();
}
async function doServiceCall(): Promise<void> {}
`;
    const verdict = checkFixture(src);
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
  });
});