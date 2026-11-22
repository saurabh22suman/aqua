import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { expect, it } from "vitest";

it("parses the entire upload payload before the permission preamble", () => {
  const source = ts.createSourceFile("branding.ts", readFileSync("lib/actions/branding.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const action = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "uploadBrandingAssetAction");
  expect(action?.body).toBeDefined();
  const first = action!.body!.statements[0];
  expect(ts.isVariableStatement(first)).toBe(true);
  if (!ts.isVariableStatement(first)) return;
  const init = first.declarationList.declarations[0]?.initializer;
  expect(init && ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text).toBe("safeParse");
  expect(init?.getText(source)).toContain("uploadFormSchema.safeParse");
});
